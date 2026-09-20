(function () {
  'use strict';

  var STORAGE_KEY = 'hb.portal.v1';
  var EVENT_KEY = 'hb.security.events';
  var PARTICIPANTS_KEY = 'hb.participants.v1';

  // Master control access is fixed for this event — only the host account is hardcoded.
  // Keep this in sync with the copy in admin.html.
  var HOST_EMAIL = 'host@humanbandwidth.dev';
  var HOST_PASSWORD = 'hbhost2026';

  var SESSION_DURATION_MS = 90 * 60 * 1000;
  var START_SCORE = 1000;
  var ROUND_POINTS = 100;
  var HINT_PENALTY = 50;

  var role = 'player';

  var firebaseState = {
    app: null,
    auth: null,
    db: null,
    isReady: false,
    unsubscribe: null
  };

  var state = {
    currentUser: null,
    sessionId: 'hb-demo-session',
    sessionStarted: false,
    timerStart: null,
    expired: false,
    challengeState: {
      'SIGNAL-01': false,
      'SIGNAL-02': false,
      'SIGNAL-03': false,
      'SIGNAL-04': false,
      'SIGNAL-05': false,
      'SIGNAL-06': false,
      'BONUS-01': false,
      'BONUS-02': false,
      'FINAL-BUILD': false
    },
    currentChallenge: 'SIGNAL-01'
  };

  var authScreen = document.getElementById('auth-screen');
  var portalScreen = document.getElementById('portal-screen');
  var resultsScreen = document.getElementById('results');
  var welcomeName = document.getElementById('welcome-name');
  var sessionStatusEl = document.getElementById('session-status');
  var challengeRail = document.getElementById('challenge-rail');
  var panelTitle = document.getElementById('panel-title');
  var panelStatus = document.getElementById('panel-status');
  var challengeBody = document.getElementById('challenge-body');
  var hudTime = document.getElementById('hud-time').querySelector('.v');
  var hudScore = document.getElementById('hud-score').querySelector('.v');
  var specBar = document.querySelector('.specbar .cells');
  var specPct = document.querySelector('.specbar .pct');
  var authForm = document.getElementById('auth-form');
  var authError = document.getElementById('auth-error');
  var authTabs = document.querySelectorAll('.auth-tab');

  /* ---------- participants directory (local persistence layer) ---------- */
  /*
   * There is no real server here, so "the backend" is a shared localStorage table
   * keyed by email. admin.html reads and writes the same table, so participant state
   * (score, rounds cleared, hints burned) is consistent between the player portal and
   * the host's master-control page as long as they run in the same browser profile.
   * Configuring firebase-config.js upgrades player auth to real accounts; the point
   * economy below stays the source of truth either way.
   */

  function normEmail(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

  function readParticipants() {
    try { return JSON.parse(localStorage.getItem(PARTICIPANTS_KEY) || '{}'); }
    catch (err) { return {}; }
  }

  function writeParticipants(map) {
    try { localStorage.setItem(PARTICIPANTS_KEY, JSON.stringify(map)); }
    catch (err) { return; }
  }

  function getParticipant(email) {
    var map = readParticipants();
    return map[normEmail(email)] || null;
  }

  function upsertParticipant(record) {
    var map = readParticipants();
    map[normEmail(record.email)] = record;
    writeParticipants(map);
    return record;
  }

  function currentParticipant() {
    return state.currentUser ? getParticipant(state.currentUser.email) : null;
  }

  function adjustScore(delta) {
    if (!state.currentUser || state.currentUser.role !== 'player') return;
    var rec = currentParticipant();
    if (!rec) return;
    rec.score = Math.max(0, (rec.score || 0) + delta);
    rec.lastSeen = Date.now();
    upsertParticipant(rec);
    state.currentUser.score = rec.score;
  }

  // Progress (which rounds are cleared) lives on the participant record, not in the
  // shared portal blob — otherwise two people logging into the same browser back to
  // back would inherit each other's solved signals. This rebuilds the in-memory view
  // from that record: on login, on reload, and whenever the host edits a participant.
  function findOrCreateScoringRecord(name, email, startScore) {
    var rec = getParticipant(email);
    if (!rec) {
      rec = {
        id: 'p-' + Math.random().toString(16).slice(2, 10),
        name: name, email: normEmail(email), password: null,
        role: 'player', status: 'online', score: startScore,
        roundsCleared: [], hintsUsed: [], createdAt: Date.now(), lastSeen: Date.now()
      };
    } else {
      rec.name = name || rec.name;
      rec.status = 'online';
      rec.lastSeen = Date.now();
    }
    upsertParticipant(rec);
    return rec;
  }

  function syncChallengeStateFromParticipant(rec) {
    ALL_CHALLENGES.forEach(function (id) {
      state.challengeState[id] = !!(rec.roundsCleared && rec.roundsCleared.indexOf(id) !== -1);
    });
    var firstOpen = CHALLENGE_ORDER.filter(function (id) { return !state.challengeState[id]; })[0];
    state.currentChallenge = firstOpen || 'FINAL-BUILD';
  }

  function signInAsParticipant(rec) {
    state.currentUser = { id: rec.id, role: 'player', name: rec.name, email: rec.email, score: rec.score };
    syncChallengeStateFromParticipant(rec);
    clearAuthError();
    saveState();
    renderPortal();
  }

  /* ---------- shared portal state (session clock, driven by the host) ---------- */

  function isFirebaseConfigured() {
    if (!window.HB_FIREBASE_CONFIG) return false;
    var cfg = window.HB_FIREBASE_CONFIG;
    return !!(cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId);
  }

  function readSecurityEvents() {
    try { return JSON.parse(localStorage.getItem(EVENT_KEY) || '[]'); }
    catch (err) { return []; }
  }

  function writeSecurityEvents(events) {
    try { localStorage.setItem(EVENT_KEY, JSON.stringify(events)); }
    catch (err) { return; }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved) return;
      Object.assign(state, saved);
    } catch (err) { return; }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (err) { return; }
  }

  function setupFirebase() {
    if (!window.firebase || !isFirebaseConfigured()) return false;

    try {
      if (!window.firebase.apps.length) {
        window.firebase.initializeApp(window.HB_FIREBASE_CONFIG);
      }
      firebaseState.app = window.firebase.apps[0];
      firebaseState.auth = window.firebase.auth();
      firebaseState.db = window.firebase.firestore();
      firebaseState.isReady = true;

      firebaseState.db.collection('sessions').doc(state.sessionId).onSnapshot(function (doc) {
        if (!doc.exists) return;
        var data = doc.data() || {};
        state.sessionStarted = !!data.sessionStarted;
        state.timerStart = data.timerStart || null;
        state.expired = !!data.expired;
        renderPortal();
      }, function (err) {
        console.warn('HB Firebase session listener failed:', err);
      });

      return true;
    } catch (err) {
      console.warn('HB Firebase setup failed:', err);
      return false;
    }
  }

  async function syncPlayerProfileToFirestore(user, displayName, isNewAccount) {
    if (!firebaseState.isReady || !firebaseState.db || !user) return;
    try {
      var payload = {
        uid: user.uid,
        name: displayName,
        email: user.email,
        role: 'player',
        status: 'online',
        lastSeen: window.firebase.firestore.FieldValue.serverTimestamp()
      };
      // Only stamp the starting score on genuine signup — a merge on every login
      // would otherwise reset a returning player's earned score back to 1000.
      if (isNewAccount) payload.score = START_SCORE;
      await firebaseState.db.collection('players').doc(user.uid).set(payload, { merge: true });
    } catch (err) {
      console.warn('HB Firestore sync failed:', err);
    }
  }

  async function logSecurityEventToFirestore(kind, detail) {
    if (!firebaseState.isReady || !firebaseState.db) return;
    try {
      await firebaseState.db.collection('security-events').add({
        kind: kind,
        detail: detail || '',
        ts: window.firebase.firestore.FieldValue.serverTimestamp(),
        page: 'player',
        participantId: state.currentUser ? state.currentUser.email : null
      });
    } catch (err) {
      console.warn('HB security log failed:', err);
    }
  }

  function setSelectedRole(nextRole) {
    role = nextRole;
    authTabs.forEach(function (button) {
      button.classList.toggle('is-selected', button.dataset.role === nextRole);
    });

    var nameInput = document.getElementById('auth-name');
    var emailInput = document.getElementById('auth-email');
    var passInput = document.getElementById('auth-password');

    if (nextRole === 'host') {
      nameInput.value = 'Host Operator';
      emailInput.value = HOST_EMAIL;
      passInput.value = HOST_PASSWORD;
    } else {
      nameInput.value = '';
      emailInput.value = '';
      passInput.value = '';
      nameInput.placeholder = 'Astra';
      emailInput.placeholder = 'you@school.edu';
      passInput.placeholder = 'choose a password';
    }
    clearAuthError();
  }

  function showAuthError(msg) {
    if (authError) authError.textContent = msg;
  }
  function clearAuthError() {
    if (authError) authError.textContent = '';
  }

  function renderSpecBar() {
    var order = ['SIGNAL-01', 'SIGNAL-02', 'SIGNAL-03', 'SIGNAL-04', 'SIGNAL-05', 'SIGNAL-06'];
    var recovered = order.filter(function (id) { return state.challengeState[id]; }).length;
    var total = order.length;
    var percent = Math.round((recovered / total) * 100);
    var filled = Math.round(percent / 10);
    var cells = Array(10).fill('░');
    for (var i = 0; i < filled; i += 1) cells[i] = '█';
    if (specBar) specBar.innerHTML = cells.join('');
    if (specPct) specPct.textContent = percent + '%';
  }

  function formatDuration(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return [h, m, s].map(function (v) { return String(v).padStart(2, '0'); }).join(':');
  }

  function renderTimer() {
    if (state.expired) {
      document.body.dataset.phase = 'final';
      renderResults();
      return;
    }

    if (!state.sessionStarted || !state.timerStart) {
      hudTime.textContent = formatDuration(SESSION_DURATION_MS);
      document.body.dataset.phase = 'normal';
      if (sessionStatusEl) sessionStatusEl.textContent = 'WAITING FOR HOST';
      return;
    }

    var remaining = Math.max(0, SESSION_DURATION_MS - (Date.now() - state.timerStart));
    hudTime.textContent = formatDuration(remaining);
    if (sessionStatusEl) sessionStatusEl.textContent = 'LIVE';

    if (remaining <= 0) {
      state.expired = true;
      saveState();
      document.body.dataset.phase = 'final';
      renderResults();
      return;
    }

    var minutesLeft = remaining / 60000;
    document.body.dataset.phase = minutesLeft <= 10 ? 'critical' : minutesLeft <= 30 ? 'warning' : 'normal';
  }

  function renderScore() {
    var rec = currentParticipant();
    var score = rec ? rec.score : START_SCORE;
    if (hudScore) hudScore.textContent = String(score);
    var liveScore = document.getElementById('live-score');
    if (liveScore) liveScore.textContent = String(score);

    var order = ['SIGNAL-01', 'SIGNAL-02', 'SIGNAL-03', 'SIGNAL-04', 'SIGNAL-05', 'SIGNAL-06'];
    var solved = order.filter(function (id) { return state.challengeState[id]; }).length;
    var liveSignals = document.getElementById('live-signal-count');
    if (liveSignals) liveSignals.textContent = solved + ' / ' + order.length;

    var liveHints = document.getElementById('live-hint-count');
    if (liveHints) liveHints.textContent = String(rec && rec.hintsUsed ? rec.hintsUsed.length : 0);

    renderSpecBar();
  }

  var CHALLENGE_ORDER = ['SIGNAL-01', 'SIGNAL-02', 'SIGNAL-03', 'SIGNAL-04', 'SIGNAL-05', 'SIGNAL-06'];
  var ALL_CHALLENGES = CHALLENGE_ORDER.concat(['BONUS-01', 'BONUS-02', 'FINAL-BUILD']);

  var signalChallengeMap = {
    'SIGNAL-01': {
      title: 'Signal 01',
      summary: 'Recover the first hidden requirement and validate the task identifier rules.',
      detail: 'Investigate the preserved artifacts. Implement the correct rule. Run the visible and hidden test cases.',
      question: 'The archive is incomplete, but the task registry still exposes a traceable pattern: a fixed prefix, a four-digit numeric core, and a final letter tag. Read the examples carefully and determine the canonical identifier that the system treats as the baseline for the next reconstruction pass.',
      answer: 'TF-0001D',
      hint: 'Look at the very first row of the registry, not the later corrupted ones — the "baseline" is the simplest possible core value.'
    },
    'SIGNAL-02': {
      title: 'Signal 02',
      summary: 'Study the ranking and scoring signal from the recovered queue data.',
      detail: 'Track how points are assigned and how hidden rules alter rank outcomes.',
      question: 'The queue audit shows a failed scoring pass on a blocked row named pending.row. Its values are u=4, i=3, b=7, the task is still within the status penalty window, and the due date lands exactly on the system boundary. If you reconstruct the scorer honestly, what integer did it write before the process died?',
      answer: '28',
      hint: 'Blocking caps out at 5 even though this row reports 7 — and a BLOCKED task has its raw total halved before it is floored.'
    },
    'SIGNAL-03': {
      title: 'Signal 03',
      summary: 'Trace the state machine and legal transitions for task lifecycle controls.',
      detail: 'Resolve lifecycle validity and ensure transitions happen in the right order.',
      question: 'The task ledger describes a workflow that begins as a new request, passes through review, and is only then closed by the operator. In proper order, what is the complete lifecycle sequence from first state to final state?',
      answer: 'OPEN -> IN REVIEW -> DONE',
      hint: 'There are exactly three stops on this path — think "new", "under review", and "closed", in that order.'
    },
    'SIGNAL-04': {
      title: 'Signal 04',
      summary: 'Unpack the deadline rollover and business-day logic for time tracking.',
      detail: 'Account for rollover conditions and the domain-specific scheduling rules.',
      question: 'A task was created at 2026-03-13T12:00:00Z and evaluated at 2026-03-14T12:00:00Z. The system counts only complete hours for the age calculation and the deadline logic is explicitly based on that grain. How many whole hours old was the task at evaluation time?',
      answer: '24',
      hint: 'Both timestamps land on the same clock time on consecutive days — count the days, then convert.'
    },
    'SIGNAL-05': {
      title: 'Signal 05',
      summary: 'Rebuild the search grammar and normalize the query tokens.',
      detail: 'Map the grammar to the actual matcher behavior before testing edge cases.',
      question: 'One search query was queued but never executed before capture ended: project:atlas status:open status:in-review -tag:infra. Replayed against the frozen snapshot, the planner reports a single surviving match. Which exact task ID is that lone result?',
      answer: 'TF-0005H',
      hint: 'Same-field filters (the two status: tokens) OR together; different fields AND together; the leading "-" excludes.'
    },
    'SIGNAL-06': {
      title: 'Signal 06',
      summary: 'Recover workload and deadline notification logic for owner queues.',
      detail: 'Combine queue ownership, score weight, and deadline warnings in one flow.',
      question: 'The queue builder does not sort arbitrarily; the audit confirms the ranking is derived from urgency, impact, and blocking in a fixed sequence. What is the exact ordering rule the system expects when it ranks tasks for the operator board?',
      answer: 'URGENCY IMPACT BLOCKING',
      hint: 'Rank the three weighted inputs by how heavily each one counts toward the final score, heaviest first.'
    },
    'BONUS-01': {
      title: 'Bonus 01',
      summary: 'Advanced optimization challenge with strict algorithmic constraints.',
      detail: 'Find the high-efficiency path while respecting the task constraints.',
      question: 'This bonus is not a brute-force shortcut; it is a strategic optimization problem. What is the governing principle the system expects you to preserve when choosing the best route through the work?',
      answer: 'MINIMIZE WORK AND MAXIMIZE FLOW',
      hint: 'Think about what a scheduler is always trying to trade off: effort spent versus throughput gained.'
    },
    'BONUS-02': {
      title: 'Bonus 02',
      summary: 'Ghost-signal reverse engineering for the hidden edge case.',
      detail: 'Inspect the boundary conditions that appear only at the limit.',
      question: 'The ghost signal exists to hide a defect behind a boundary condition rather than a general failure. What kind of scenario is it specifically designed to test?',
      answer: 'BOUNDARY CASE',
      hint: 'It never breaks on typical input — only right at the edge of what is valid.'
    },
    'FINAL-BUILD': {
      title: 'Final Build',
      summary: 'Implement the complete taskflow and validate it with the full strategic pass.',
      detail: 'Submit the final solution only after the full flow has been validated.',
      question: 'Before the final package can be submitted, the entire build must be checked against the expected system behavior end-to-end. What is the mandatory condition that must be satisfied before you lock in the final result?',
      answer: 'VALIDATE ALL TESTS',
      hint: 'Re-read every recovered requirement in your spec panel before you submit — that full checklist is the condition.'
    }
  };

  function normalizeAnswer(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function challengeUnlocked(challengeId) {
    var idx = CHALLENGE_ORDER.indexOf(challengeId);
    if (idx === -1) return true;
    if (idx === 0) return true;
    return !!state.challengeState[CHALLENGE_ORDER[idx - 1]];
  }

  function completeChallenge(challengeId) {
    state.challengeState[challengeId] = true;

    var rec = currentParticipant();
    var already = rec && rec.roundsCleared && rec.roundsCleared.indexOf(challengeId) !== -1;
    if (rec && !already) {
      rec.roundsCleared = rec.roundsCleared || [];
      rec.roundsCleared.push(challengeId);
      upsertParticipant(rec);
      adjustScore(ROUND_POINTS);
    }

    saveState();
    renderChallengeRail();
    updateChallengeView();
    renderScore();

    var idx = CHALLENGE_ORDER.indexOf(challengeId);
    if (idx >= 0 && idx < CHALLENGE_ORDER.length - 1) {
      state.currentChallenge = CHALLENGE_ORDER[idx + 1];
      saveState();
      renderChallengeRail();
      updateChallengeView();
    }
  }

  function useHint(challengeId) {
    var rec = currentParticipant();
    if (!rec) return;
    rec.hintsUsed = rec.hintsUsed || [];
    if (rec.hintsUsed.indexOf(challengeId) === -1) {
      rec.hintsUsed.push(challengeId);
      upsertParticipant(rec);
      adjustScore(-HINT_PENALTY);
      saveState();
    }
    renderScore();
    updateChallengeView();
  }

  function renderChallengeRail() {
    if (!challengeRail) return;
    challengeRail.innerHTML = '';

    ALL_CHALLENGES.forEach(function (id) {
      var meta = signalChallengeMap[id];
      var solved = !!state.challengeState[id];
      var locked = !challengeUnlocked(id) && !solved;

      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'rail-item';
      if (id === state.currentChallenge) item.classList.add('active');
      if (solved) item.classList.add('solved');
      else if (locked) item.classList.add('locked');
      else item.classList.add('open');

      item.innerHTML = '<span class="dot"></span><span class="nm">' + meta.title + '</span>';
      item.addEventListener('click', function () {
        state.currentChallenge = id;
        saveState();
        renderChallengeRail();
        updateChallengeView();
      });
      challengeRail.appendChild(item);
    });
  }

  function hintBlockHtml(challengeId, rec) {
    var meta = signalChallengeMap[challengeId];
    var used = !!(rec && rec.hintsUsed && rec.hintsUsed.indexOf(challengeId) !== -1);
    return [
      '<div class="hint-block">',
      '<button id="use-hint" class="btn ghost sm" type="button">' +
        (used ? 'HINT REVEALED (-' + HINT_PENALTY + ')' : 'USE HINT (-' + HINT_PENALTY + ' PTS)') + '</button>',
      used ? '<p class="hint-text"><span class="lead">HINT</span> ' + meta.hint + '</p>' : '',
      '</div>'
    ].join('');
  }

  function bindHintButton(challengeId) {
    var btn = document.getElementById('use-hint');
    if (!btn) return;
    var rec = currentParticipant();
    var used = !!(rec && rec.hintsUsed && rec.hintsUsed.indexOf(challengeId) !== -1);
    if (used) { btn.disabled = true; return; }
    btn.addEventListener('click', function () { useHint(challengeId); });
  }

  function updateChallengeView() {
    var challenge = signalChallengeMap[state.currentChallenge] || signalChallengeMap['SIGNAL-01'];
    var rec = currentParticipant();
    panelTitle.textContent = challenge.title;
    panelStatus.textContent = state.currentChallenge === 'FINAL-BUILD' ? 'Implementation' : (state.challengeState[state.currentChallenge] ? 'Solved' : 'Open');

    if (state.currentChallenge === 'FINAL-BUILD') {
      var buildSolved = !!state.challengeState['FINAL-BUILD'];
      challengeBody.innerHTML = [
        '<p class="kicker">TASKFLOW</p>',
        '<h2>Final build phase</h2>',
        '<p>' + challenge.summary + '</p>',
        '<ul class="rules">',
        '<li>Task creation, deletion, completion, editing, and deadline handling.</li>',
        '<li>Priority scoring, search, filtering, overdue detection, and workload rules.</li>',
        '<li>Visible tests: 12. Hidden tests: 20.</li>',
        '</ul>',
        hintBlockHtml('FINAL-BUILD', rec),
        '<div class="toolbar"><button id="submit-final" class="btn primary" ' + (buildSolved ? 'disabled' : '') + '>' +
          (buildSolved ? 'SUBMITTED' : 'SUBMIT FINAL SOLUTION') + '</button></div>'
      ].join('');
      bindHintButton('FINAL-BUILD');
      var submitFinal = document.getElementById('submit-final');
      if (submitFinal && !buildSolved) {
        submitFinal.addEventListener('click', function () {
          completeChallenge('FINAL-BUILD');
          renderResults();
        });
      }
      return;
    }

    var isSolved = !!state.challengeState[state.currentChallenge];
    var lockedMessage = !challengeUnlocked(state.currentChallenge) && !isSolved ?
      '<div class="answer-feedback error">Locked: solve the previous signal before you can continue.</div>' : '';
    challengeBody.innerHTML = [
      '<p class="kicker">BRIEFING</p>',
      '<h2>' + challenge.title + '</h2>',
      '<p>' + challenge.summary + '</p>',
      '<ul class="rules">',
      '<li>' + challenge.detail + '</li>',
      '<li>Validate with the visible and hidden tests before advancing.</li>',
      '<li>Observe the remaining session clock — the host controls when it starts.</li>',
      '</ul>',
      '<div class="signal-answer-box">',
      '<label for="signal-answer">Question</label>',
      '<p class="signal-question">' + challenge.question + '</p>',
      lockedMessage,
      '<input id="signal-answer" type="text" autocomplete="off" spellcheck="false" placeholder="Type the exact answer" ' + (isSolved ? 'disabled' : '') + '>',
      '<div class="toolbar">',
      '<button id="check-answer" class="btn primary" ' + (isSolved ? 'disabled' : '') + '>CHECK ANSWER</button>',
      '</div>',
      '<div id="answer-feedback" class="answer-feedback"></div>',
      hintBlockHtml(state.currentChallenge, rec),
      '</div>'
    ].join('');

    bindHintButton(state.currentChallenge);

    if (isSolved) {
      var feedback = document.getElementById('answer-feedback');
      if (feedback) { feedback.className = 'answer-feedback success'; feedback.textContent = 'Correct. This signal is complete. +' + ROUND_POINTS + ' pts.'; }
      return;
    }

    var answerInput = document.getElementById('signal-answer');
    var checkAnswer = document.getElementById('check-answer');
    if (checkAnswer) {
      checkAnswer.addEventListener('click', function () {
        if (!answerInput) return;
        var value = normalizeAnswer(answerInput.value);
        var expected = normalizeAnswer(challenge.answer);
        var feedback = document.getElementById('answer-feedback');

        if (value === expected) {
          completeChallenge(state.currentChallenge);
          return;
        }

        if (feedback) {
          feedback.className = 'answer-feedback error';
          feedback.textContent = 'Incorrect answer. Try again before moving to the next signal.';
        }
      });
    }
  }

  function renderPortal() {
    if (!state.currentUser) {
      authScreen.classList.add('is-active');
      portalScreen.classList.remove('is-active');
      resultsScreen.classList.remove('is-active');
      return;
    }

    if (state.expired) { renderResults(); return; }

    authScreen.classList.remove('is-active');
    portalScreen.classList.add('is-active');
    resultsScreen.classList.remove('is-active');

    welcomeName.textContent = 'Welcome back, ' + state.currentUser.name;
    renderTimer();
    renderScore();
    renderChallengeRail();
    updateChallengeView();
  }

  function rankForScore(score) {
    if (score >= 1700) return 'ARCHITECT';
    if (score >= 1500) return 'ENGINEER';
    if (score >= 1300) return 'BUILDER';
    if (score >= 1100) return 'DEBUGGER';
    return 'SIGNAL LOST';
  }

  function renderResults() {
    var rec = currentParticipant() || {};
    var solvedSignals = CHALLENGE_ORDER.filter(function (id) { return state.challengeState[id]; }).length;
    var solvedBonus = ['BONUS-01', 'BONUS-02'].filter(function (id) { return state.challengeState[id]; }).length;
    var hints = (rec.hintsUsed || []).length;
    var score = rec.score != null ? rec.score : START_SCORE;
    var elapsed = state.timerStart ? Math.min(Date.now() - state.timerStart, SESSION_DURATION_MS) : 0;

    var byTimeout = state.expired;
    var titleEl = document.getElementById('res-banner-title');
    var line1 = document.getElementById('res-banner-line1');
    var line2 = document.getElementById('res-banner-line2');
    var banner = document.getElementById('res-banner');
    if (titleEl && line1 && line2 && banner) {
      if (byTimeout) {
        banner.classList.add('lock-banner');
        titleEl.textContent = "TIME'S UP";
        line1.textContent = 'YOUR BANDWIDTH HAS BEEN EXHAUSTED.';
        line2.textContent = 'SUBMISSION LOCKED.';
      } else {
        titleEl.textContent = 'RUN COMPLETE';
        line1.textContent = 'FINAL SOLUTION SUBMITTED.';
        line2.textContent = 'RESULTS LOCKED IN.';
      }
    }

    document.getElementById('res-time-used').textContent = formatDuration(elapsed);
    document.getElementById('res-spec').textContent = solvedSignals + ' / ' + CHALLENGE_ORDER.length;
    document.getElementById('res-bonus').textContent = solvedBonus + ' / 2';
    document.getElementById('res-hints').textContent = String(hints);
    document.getElementById('res-score').textContent = String(score);
    document.getElementById('res-rank').textContent = rankForScore(score);

    authScreen.classList.remove('is-active');
    portalScreen.classList.remove('is-active');
    resultsScreen.classList.add('is-active');
  }

  function recordSecurityEvent(kind, detail) {
    var events = readSecurityEvents();
    events.push({
      kind: kind,
      detail: detail || '',
      ts: new Date().toISOString(),
      page: state.currentUser && state.currentUser.role ? state.currentUser.role : 'player',
      participantId: state.currentUser ? state.currentUser.email : null,
      participantName: state.currentUser ? state.currentUser.name : null
    });
    if (events.length > 200) events = events.slice(events.length - 200);
    writeSecurityEvents(events);
    logSecurityEventToFirestore(kind, detail);
  }

  function installSecurityGuards() {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) recordSecurityEvent('tab-switch', 'document hidden');
    });

    window.addEventListener('blur', function () {
      recordSecurityEvent('tab-switch', 'window lost focus');
    });

    document.addEventListener('copy', function (event) {
      event.preventDefault();
      recordSecurityEvent('copy-attempt', 'copy blocked');
    });

    document.addEventListener('cut', function (event) {
      event.preventDefault();
      recordSecurityEvent('copy-attempt', 'cut blocked');
    });

    document.addEventListener('paste', function (event) {
      event.preventDefault();
      recordSecurityEvent('copy-attempt', 'paste blocked');
    });

    document.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      recordSecurityEvent('context-menu', 'right click blocked');
    });

    document.addEventListener('keydown', function (event) {
      var key = (event.key || '').toLowerCase();
      var combo = event.ctrlKey || event.metaKey;
      var blockedKeys = ['c', 'v', 'x', 'a', 's', 'p', 'u', 'i', 'l'];
      if (combo && blockedKeys.indexOf(key) !== -1) {
        event.preventDefault();
        recordSecurityEvent('shortcut-blocked', key);
        return;
      }
      if (event.key === 'F12' || (event.ctrlKey && event.shiftKey && key === 'i')) {
        event.preventDefault();
        recordSecurityEvent('devtools-tamper', 'blocked');
      }
    });
  }

  /* ---------- authentication ---------- */

  function loginOrRegisterLocalPlayer(name, email, password) {
    var existing = getParticipant(email);
    if (existing && existing.password != null && existing.password !== password) {
      showAuthError('That email is already registered with a different password.');
      return;
    }
    var rec = findOrCreateScoringRecord(name, email, START_SCORE);
    rec.password = password;
    upsertParticipant(rec);
    signInAsParticipant(rec);
  }

  async function authenticateWithFirebase(name, email, password) {
    try {
      var userCred = await firebaseState.auth.signInWithEmailAndPassword(email, password);
      var user = userCred.user;
      await user.updateProfile({ displayName: name });
      var rec = findOrCreateScoringRecord(name, user.email, START_SCORE);
      await syncPlayerProfileToFirestore(user, name, false);
      signInAsParticipant(rec);
    } catch (err) {
      if (err && err.code === 'auth/invalid-credential') {
        try {
          var created = await firebaseState.auth.createUserWithEmailAndPassword(email, password);
          await created.user.updateProfile({ displayName: name });
          var newRec = findOrCreateScoringRecord(name, created.user.email, START_SCORE);
          await syncPlayerProfileToFirestore(created.user, name, true);
          signInAsParticipant(newRec);
        } catch (createErr) {
          console.warn('HB Firebase create user failed:', createErr);
          showAuthError('Could not create that account. Try a different email.');
        }
      } else {
        console.warn('HB Firebase auth failed:', err);
        showAuthError('Sign-in failed. Check your email and password.');
      }
    }
  }

  function authenticate(nextRole, name, email, password) {
    email = String(email || '').trim();
    password = String(password || '');

    if (nextRole === 'host') {
      if (normEmail(email) === HOST_EMAIL && password === HOST_PASSWORD) {
        try { sessionStorage.setItem('hb.host.authed', '1'); } catch (err) { /* ignore */ }
        window.location.href = 'admin.html';
        return;
      }
      showAuthError('Host access is fixed for this event — check the email and password.');
      return;
    }

    if (firebaseState.isReady && firebaseState.auth) {
      authenticateWithFirebase(name, email, password);
      return;
    }

    loginOrRegisterLocalPlayer(name, email, password);
  }

  function bindEvents() {
    authTabs.forEach(function (button) {
      button.addEventListener('click', function () {
        setSelectedRole(button.dataset.role);
      });
    });

    authForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var name = document.getElementById('auth-name').value.trim();
      var email = document.getElementById('auth-email').value.trim();
      var password = document.getElementById('auth-password').value.trim();
      if (!name || !email || !password) { showAuthError('Fill in every field to continue.'); return; }
      authenticate(role, name, email, password);
    });

    window.addEventListener('storage', function (event) {
      if (event.key === STORAGE_KEY) {
        loadState();
        renderPortal();
        return;
      }
      // The host edits participants (reset/remove) on a separate page, writing
      // directly to the participants table — pick that up live in any open tab.
      if (event.key === PARTICIPANTS_KEY && state.currentUser) {
        var rec = getParticipant(state.currentUser.email);
        if (!rec) {
          state.currentUser = null;
          saveState();
          renderPortal();
          return;
        }
        state.currentUser.score = rec.score;
        syncChallengeStateFromParticipant(rec);
        saveState();
        renderPortal();
      }
    });
  }

  function init() {
    loadState();
    if (state.currentUser) {
      var rec = getParticipant(state.currentUser.email);
      if (rec) {
        state.currentUser.score = rec.score;
        syncChallengeStateFromParticipant(rec);
      } else {
        state.currentUser = null;
      }
    }
    setSelectedRole('player');
    bindEvents();
    installSecurityGuards();
    setupFirebase();
    renderPortal();
    window.setInterval(function () {
      if (state.currentUser) renderTimer();
    }, 250);
  }

  init();
})();
