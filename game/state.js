/* HUMAN BANDWIDTH — run state, progression and scoring.
 *
 * The clock is derived from a stored start timestamp, never from an accumulating
 * counter, so reloading the page cannot buy the player more time.
 */
(function (HB) {
  'use strict';

  var KEY = 'hb.run.v2';
  var DURATION_MS = 90 * 60 * 1000;

  /* Unlock the final build with this much time left even if signals are outstanding,
     so nobody can be hard-blocked out of the phase the whole event builds toward. */
  var BUILD_MERCY_MS = 45 * 60 * 1000;

  var SCORE = {
    signal: 100,
    bonus01: 150,
    bonus02Exploit: 80,
    bonus02Patch: 120,
    visibleTest: 15,
    hiddenTest: 20,
    hint: -30,
    timePerMinute: 4        // applied per second, so a partial minute still counts
  };

  var RANKS = [
    { min: 1400, name: 'ARCHITECT' },
    { min: 1150, name: 'ENGINEER' },
    { min: 900,  name: 'BUILDER' },
    { min: 650,  name: 'DEBUGGER' },
    { min: -1e9, name: 'SIGNAL LOST' }
  ];

  var LIVES = 3;
  var COOLDOWN_MS = 90 * 1000;
  var COOLDOWN_DESPERATE_MS = 180 * 1000;

  var state = null;

  function blankChallenge() {
    return {
      status: 'locked',       // locked | open | solved | bypassed
      probeOk: false,
      exploitOk: false,
      code: null,
      hints: [],              // indices revealed
      attempts: 0,
      lockedUntil: 0,
      passed: 0,
      total: 0
    };
  }

  function fresh() {
    return {
      version: 2,
      startedAt: null,
      finishedAt: null,
      finished: false,
      expired: false,
      lives: LIVES,
      challenges: {},
      build: { code: null, visiblePassed: 0, hiddenPassed: 0, ran: false, submitted: false, results: null },
      recovered: [],
      events: []
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return (s && s.version === 2) ? s : null;
    } catch (e) { return null; }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { /* private mode — the run simply will not survive a reload */ }
  }

  function reset() {
    state = fresh();
    save();
    return state;
  }

  function init() {
    state = load() || fresh();
    HB.content.all().forEach(function (c) {
      if (!state.challenges[c.id]) state.challenges[c.id] = blankChallenge();
    });
    refreshLocks();
    return state;
  }

  function get() { return state; }

  function started() { return state.startedAt != null; }

  function start() {
    if (state.startedAt) return;
    state.startedAt = Date.now();
    note('RUN STARTED — 120:00 allocated');
    refreshLocks();
    save();
  }

  function msLeft() {
    if (!state.startedAt) return DURATION_MS;
    if (state.finished && state.finishedAt) return Math.max(0, state.startedAt + DURATION_MS - state.finishedAt);
    return Math.max(0, state.startedAt + DURATION_MS - Date.now());
  }

  function msUsed() { return DURATION_MS - msLeft(); }

  function phase() {
    var m = msLeft() / 60000;
    if (m > 30) return 'normal';
    if (m > 10) return 'warning';
    if (m > 1) return 'critical';
    return 'final';
  }

  function note(msg) {
    state.events.push({ t: Date.now(), msg: msg });
    if (state.events.length > 400) state.events.shift();
  }

  /* ---------- progression ---------- */

  function ch(id) { return state.challenges[id]; }
  function resolved(id) { var c = ch(id); return c && (c.status === 'solved' || c.status === 'bypassed'); }

  function signalsResolved() {
    return HB.content.signals().filter(function (s) { return resolved(s.id); }).length;
  }
  function signalsSolved() {
    return HB.content.signals().filter(function (s) { return ch(s.id).status === 'solved'; }).length;
  }

  function buildUnlocked() {
    if (!started()) return false;
    if (signalsResolved() === HB.content.signals().length) return true;
    return msLeft() <= BUILD_MERCY_MS;
  }

  // Signals open strictly in order; bonuses open once SIGNAL-02 is behind the player.
  function refreshLocks() {
    if (!started()) return;
    var sigs = HB.content.signals();
    var openNext = true;
    sigs.forEach(function (s) {
      var c = ch(s.id);
      if (c.status === 'solved' || c.status === 'bypassed') return;
      if (openNext) { c.status = 'open'; openNext = false; }
      else c.status = 'locked';
    });
    var gate = sigs[1] && resolved(sigs[1].id);
    HB.content.bonuses().forEach(function (b) {
      var c = ch(b.id);
      if (c.status === 'solved' || c.status === 'bypassed') return;
      c.status = gate ? 'open' : 'locked';
    });
  }

  function isOpen(id) {
    var c = ch(id);
    return c && (c.status === 'open' || c.status === 'solved' || c.status === 'bypassed');
  }

  function cooldownLeft(id) {
    var c = ch(id);
    if (!c) return 0;
    return Math.max(0, c.lockedUntil - Date.now());
  }

  /* ---------- player actions ---------- */

  function saveCode(id, code) {
    if (id === 'FINAL-BUILD') state.build.code = code;
    else ch(id).code = code;
    save();
  }

  function codeFor(id) {
    if (id === 'FINAL-BUILD') {
      return state.build.code != null ? state.build.code : (HB.content.build() || {}).starter || '';
    }
    var c = ch(id), def = HB.content.byId(id);
    return c.code != null ? c.code : (def ? def.starter : '');
  }

  function passProbe(id) {
    var c = ch(id);
    if (c.probeOk) return;
    c.probeOk = true;
    note(id + ' — investigation cleared');
    save();
  }

  function passExploit(id) {
    var c = ch(id);
    if (c.exploitOk) return;
    c.exploitOk = true;
    note(id + ' — exploit confirmed (+' + SCORE.bonus02Exploit + ')');
    save();
  }

  function revealHint(id, index) {
    var c = ch(id);
    if (c.hints.indexOf(index) !== -1) return false;
    c.hints.push(index);
    note(id + ' — hint ' + (index + 1) + ' burned (' + SCORE.hint + ')');
    save();
    return true;
  }

  function hintsUsed() {
    var n = 0;
    Object.keys(state.challenges).forEach(function (k) { n += state.challenges[k].hints.length; });
    return n;
  }

  function solve(id, passed, total) {
    var c = ch(id), def = HB.content.byId(id);
    c.status = 'solved';
    c.passed = passed;
    c.total = total;
    c.lockedUntil = 0;
    if (def && def.reveal && def.reveal.reqId && state.recovered.indexOf(def.reveal.reqId) === -1) {
      state.recovered.push(def.reveal.reqId);
      note('SPECIFICATION RECOVERED — ' + def.reveal.reqId + ' ' + def.reveal.title);
    } else {
      note(id + ' — transmitted clean');
    }
    refreshLocks();
    save();
  }

  function failTransmit(id) {
    var c = ch(id);
    c.attempts++;
    var desperate = state.lives <= 0;
    if (!desperate) state.lives--;
    var cd = desperate ? COOLDOWN_DESPERATE_MS : COOLDOWN_MS;
    c.lockedUntil = Date.now() + cd;
    note(id + ' — transmission rejected' + (desperate ? '' : ' (life lost)') + ', locked ' + Math.round(cd / 1000) + 's');
    save();
    return { livesLeft: state.lives, cooldownMs: cd };
  }

  function bypass(id) {
    var c = ch(id);
    if (c.status === 'solved') return;
    c.status = 'bypassed';
    c.lockedUntil = 0;
    if (state.lives > 0) state.lives--;
    note(id + ' — BYPASSED. Requirement not recovered.');
    refreshLocks();
    save();
  }

  function recordBuild(results) {
    var vis = results.filter(function (r) { return r.visible && r.ok; }).length;
    var hid = results.filter(function (r) { return !r.visible && r.ok; }).length;
    state.build.ran = true;
    state.build.visiblePassed = vis;
    state.build.hiddenPassed = hid;
    state.build.results = results.map(function (r) {
      return { name: r.name, visible: r.visible, area: r.area, ok: r.ok, err: r.err };
    });
    save();
    return { vis: vis, hid: hid };
  }

  function submit() {
    if (state.finished) return;
    state.finished = true;
    state.finishedAt = Date.now();
    state.build.submitted = true;
    note('FINAL SUBMISSION — ' + fmt(msLeft()) + ' unused');
    save();
  }

  function expire() {
    if (state.finished) return;
    state.finished = true;
    state.expired = true;
    state.finishedAt = state.startedAt + DURATION_MS;
    note('TIME EXPIRED — submission locked');
    save();
  }

  /* ---------- scoring ---------- */

  function bonusPoints(id) {
    var c = ch(id);
    if (id === 'BONUS-01') return c.status === 'solved' ? SCORE.bonus01 : 0;
    if (id === 'BONUS-02') {
      var p = 0;
      if (c.exploitOk) p += SCORE.bonus02Exploit;
      if (c.status === 'solved') p += SCORE.bonus02Patch;
      return p;
    }
    return 0;
  }

  /* Live score. The time bonus only lands on a completed run — it is the reward for
     finishing early, not a number that quietly bleeds away while you work. */
  function score(final) {
    var lines = [];
    var sig = signalsSolved();
    lines.push({ k: 'Specification', detail: sig + ' / ' + HB.content.signals().length, v: sig * SCORE.signal });

    var b1 = bonusPoints('BONUS-01');
    var b2 = bonusPoints('BONUS-02');
    if (b1 || final) lines.push({ k: 'Bonus 01 — Overclock', detail: b1 ? 'cleared' : '—', v: b1 });
    if (b2 || final) lines.push({ k: 'Bonus 02 — Ghost Signal', detail: b2 ? (ch('BONUS-02').status === 'solved' ? 'cleared' : 'exploit only') : '—', v: b2 });

    var vis = state.build.visiblePassed, hid = state.build.hiddenPassed;
    var bt = HB.content.build();
    var visTotal = bt ? bt.tests.filter(function (t) { return t.visible; }).length : 12;
    var hidTotal = bt ? bt.tests.filter(function (t) { return !t.visible; }).length : 20;
    if (state.build.ran || final) {
      lines.push({ k: 'Visible tests', detail: vis + ' / ' + visTotal, v: vis * SCORE.visibleTest });
      lines.push({ k: 'Hidden tests', detail: hid + ' / ' + hidTotal, v: hid * SCORE.hiddenTest });
    }

    var hints = hintsUsed();
    if (hints) lines.push({ k: 'Hints burned', detail: String(hints), v: hints * SCORE.hint });

    var timeBonus = 0;
    if (final && !state.expired) {
      timeBonus = Math.floor(msLeft() / 1000 * SCORE.timePerMinute / 60);
      lines.push({ k: 'Time remaining', detail: fmt(msLeft()), v: timeBonus });
    }

    var total = lines.reduce(function (a, l) { return a + l.v; }, 0);
    return { lines: lines, total: total, rank: rankFor(total) };
  }

  function rankFor(total) {
    for (var i = 0; i < RANKS.length; i++) if (total >= RANKS[i].min) return RANKS[i].name;
    return 'SIGNAL LOST';
  }

  function specPercent() {
    var reqs = HB.content.signals().length;
    return reqs ? Math.round(state.recovered.length / reqs * 100) : 0;
  }

  /* ---------- formatting ---------- */

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  // Above an hour the clock reads HH:MM:SS; below it reads MM:SS, so the last minute
  // is the stark "00:59" the brief asks for.
  function fmt(ms) {
    var t = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h > 0 ? pad(h) + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  function fmtLong(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    return pad(Math.floor(t / 3600)) + ':' + pad(Math.floor((t % 3600) / 60)) + ':' + pad(t % 60);
  }

  HB.state = {
    SCORE: SCORE, RANKS: RANKS, DURATION_MS: DURATION_MS, LIVES: LIVES,
    init: init, get: get, reset: reset, save: save,
    start: start, started: started, msLeft: msLeft, msUsed: msUsed, phase: phase,
    ch: ch, resolved: resolved, isOpen: isOpen, refreshLocks: refreshLocks,
    signalsSolved: signalsSolved, signalsResolved: signalsResolved,
    buildUnlocked: buildUnlocked, cooldownLeft: cooldownLeft,
    saveCode: saveCode, codeFor: codeFor,
    passProbe: passProbe, passExploit: passExploit, revealHint: revealHint, hintsUsed: hintsUsed,
    solve: solve, failTransmit: failTransmit, bypass: bypass,
    recordBuild: recordBuild, submit: submit, expire: expire,
    score: score, bonusPoints: bonusPoints, specPercent: specPercent,
    note: note, fmt: fmt, fmtLong: fmtLong
  };
})(window.HB = window.HB || {});
