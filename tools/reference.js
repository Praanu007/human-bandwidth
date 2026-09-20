/* TASKFLOW reference implementation.
 *
 * This is the oracle. Every expected value in every test — signal, bonus and final
 * build — is computed by running this file, never by hand. It implements docs/CANON.md
 * exactly. Players never see it.
 *
 * Runs in Node (module.exports) and in the browser (window.TASKFLOW_REF).
 */
'use strict';

var HOLIDAYS = ['2026-01-01', '2026-07-04', '2026-11-26', '2026-12-25'];

var TRANSITIONS = {
  DRAFT:       ['OPEN', 'CANCELLED'],
  OPEN:        ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'IN_REVIEW', 'OPEN', 'CANCELLED'],
  BLOCKED:     ['IN_PROGRESS', 'OPEN', 'CANCELLED'],
  IN_REVIEW:   ['DONE', 'IN_PROGRESS', 'BLOCKED'],
  DONE:        ['ARCHIVED', 'IN_PROGRESS'],
  CANCELLED:   ['ARCHIVED'],
  ARCHIVED:    []
};

var CLOSED = { DONE: true, CANCELLED: true, ARCHIVED: true };

/* ---------- time helpers ---------- */

function ms(iso) { return Date.parse(iso); }
function hoursBetween(a, b) { return (ms(b) - ms(a)) / 3600000; }
function hoursUntil(due, now) { return (ms(due) - ms(now)) / 3600000; }
function dateKey(iso) { return new Date(ms(iso)).toISOString().slice(0, 10); }

function isBusinessDay(iso) {
  var d = new Date(ms(iso));
  var dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return HOLIDAYS.indexOf(dateKey(iso)) === -1;
}

/* REQ-04.1 — roll a non-business-day deadline forward to 17:00:00Z. */
function rollDeadline(iso) {
  if (iso == null) return null;
  if (isBusinessDay(iso)) return new Date(ms(iso)).toISOString().replace('.000Z', 'Z');
  var d = new Date(ms(iso));
  d.setUTCHours(17, 0, 0, 0);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (!isBusinessDay(d.toISOString()));
  d.setUTCHours(17, 0, 0, 0);
  return d.toISOString().replace('.000Z', 'Z');
}

/* REQ-04.5 */
function businessDaysBetween(aISO, bISO) {
  var a = dateKey(aISO), b = dateKey(bISO);
  if (a === b) return 0;
  if (b < a) return -businessDaysBetween(bISO, aISO);
  var cur = new Date(a + 'T00:00:00Z');
  var end = new Date(b + 'T00:00:00Z');
  var n = 0;
  while (cur.getTime() < end.getTime()) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (isBusinessDay(cur.toISOString())) n++;
  }
  return n;
}

/* ---------- REQ-01 — identifiers ---------- */

function encodeTaskId(seq) {
  var core = seq.toString(36).toUpperCase().padStart(4, '0');
  var sum = 0;
  for (var i = 0; i < core.length; i++) sum += core.charCodeAt(i);
  return 'TF-' + core + (sum % 36).toString(36).toUpperCase();
}

function decodeTaskId(id) {
  if (typeof id !== 'string' || id.length !== 8 || id.slice(0, 3) !== 'TF-') throw new Error('BAD_ID');
  var core = id.slice(3, 7), check = id.charAt(7);
  if (!/^[0-9A-Z]{4}$/.test(core) || !/^[0-9A-Z]$/.test(check)) throw new Error('BAD_ID');
  var sum = 0;
  for (var i = 0; i < 4; i++) sum += core.charCodeAt(i);
  if ((sum % 36).toString(36).toUpperCase() !== check) throw new Error('BAD_ID');
  return parseInt(core, 36);
}

/* ---------- REQ-02 — priority ---------- */

function priorityScore(task, nowISO) {
  if (CLOSED[task.status]) return 0;
  var base = 5 * task.urgency + 3 * task.impact + 2 * Math.min(task.blocking, 5);
  var ageDays = Math.floor(hoursBetween(task.createdAt, nowISO) / 24);
  var ageBonus = Math.min(Math.max(ageDays, 0), 10);
  var dueFactor = 0;
  if (task.dueAt != null) {
    var h = hoursUntil(task.dueAt, nowISO);
    dueFactor = h <= 0 ? 25 : h <= 24 ? 15 : h <= 72 ? 8 : h <= 168 ? 3 : 0;
  }
  var raw = base + ageBonus + dueFactor;
  if (task.status === 'BLOCKED') raw = raw * 0.5;
  return Math.min(100, Math.floor(raw));
}

/* Canonical ordering: score DESC, dueAt ASC (nulls last), createdAt ASC, id ASC. */
function canonicalSort(tasks, nowISO) {
  return tasks.slice().sort(function (x, y) {
    var sx = priorityScore(x, nowISO), sy = priorityScore(y, nowISO);
    if (sx !== sy) return sy - sx;
    if (x.dueAt == null && y.dueAt != null) return 1;
    if (y.dueAt == null && x.dueAt != null) return -1;
    if (x.dueAt != null && y.dueAt != null && x.dueAt !== y.dueAt) return ms(x.dueAt) - ms(y.dueAt);
    if (x.createdAt !== y.createdAt) return ms(x.createdAt) - ms(y.createdAt);
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

/* ---------- store + CRUD ---------- */

function createStore() { return { tasks: [], seq: 0 }; }

function clampInt(v, lo, hi) {
  var n = Math.trunc(Number(v) || 0);
  if (n < lo) n = lo;
  if (hi != null && n > hi) n = hi;
  return n;
}

function createTask(store, input) {
  if (input == null || typeof input.title !== 'string' || input.title.trim() === '') {
    throw new Error('TITLE_REQUIRED');
  }
  store.seq += 1;
  var task = {
    id: encodeTaskId(store.seq),
    title: input.title,
    description: input.description == null ? '' : input.description,
    owner: input.owner == null ? null : input.owner,
    urgency: clampInt(input.urgency, 0, 5),
    impact: clampInt(input.impact, 0, 5),
    blocking: clampInt(input.blocking, 0, null),
    dueAt: rollDeadline(input.dueAt == null ? null : input.dueAt),
    tags: Array.isArray(input.tags) ? input.tags.slice() : [],
    status: 'DRAFT',
    createdAt: input.createdAt,
    completedAt: null,
    history: []
  };
  store.tasks.push(task);
  return task;
}

function getTask(store, id) {
  for (var i = 0; i < store.tasks.length; i++) if (store.tasks[i].id === id) return store.tasks[i];
  return null;
}

function mustGet(store, id) {
  var t = getTask(store, id);
  if (!t) throw new Error('NOT_FOUND');
  return t;
}

function updateTask(store, id, patch) {
  var t = mustGet(store, id);
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'status')) throw new Error('USE_TRANSITION');
  if (!patch) return t;
  if (patch.title != null) {
    if (String(patch.title).trim() === '') throw new Error('TITLE_REQUIRED');
    t.title = patch.title;
  }
  if (patch.description != null) t.description = patch.description;
  if (Object.prototype.hasOwnProperty.call(patch, 'owner')) t.owner = patch.owner;
  if (patch.urgency != null) t.urgency = clampInt(patch.urgency, 0, 5);
  if (patch.impact != null) t.impact = clampInt(patch.impact, 0, 5);
  if (patch.blocking != null) t.blocking = clampInt(patch.blocking, 0, null);
  if (Array.isArray(patch.tags)) t.tags = patch.tags.slice();
  if (Object.prototype.hasOwnProperty.call(patch, 'dueAt')) t.dueAt = rollDeadline(patch.dueAt);
  return t;
}

function deleteTask(store, id) {
  for (var i = 0; i < store.tasks.length; i++) {
    if (store.tasks[i].id === id) { store.tasks.splice(i, 1); return true; }
  }
  return false;
}

function setDeadline(store, id, dueAtISO) {
  var t = mustGet(store, id);
  t.dueAt = rollDeadline(dueAtISO);
  return t;
}

/* ---------- REQ-03 — transitions ---------- */

function transition(store, id, nextStatus, atISO) {
  var t = mustGet(store, id);
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, nextStatus)) throw new Error('UNKNOWN_STATUS');
  if (t.status === nextStatus) return t;
  if (TRANSITIONS[t.status].indexOf(nextStatus) === -1) throw new Error('ILLEGAL_TRANSITION');
  var from = t.status;
  t.status = nextStatus;
  t.history.push({ from: from, to: nextStatus, at: atISO });
  if (nextStatus === 'DONE') t.completedAt = atISO;
  else if (from === 'DONE') t.completedAt = null;
  return t;
}

function completeTask(store, id, atISO) {
  var t = mustGet(store, id);
  if (t.status === 'DONE') return t;
  if (t.status === 'IN_PROGRESS') {
    if (t.tags.indexOf('fast-track') === -1) throw new Error('REVIEW_REQUIRED');
    var from = t.status;
    t.status = 'DONE';
    t.history.push({ from: from, to: 'DONE', at: atISO });
    t.completedAt = atISO;
    return t;
  }
  return transition(store, id, 'DONE', atISO);
}

/* ---------- REQ-04 — overdue ---------- */

function isOverdue(task, nowISO) {
  if (task.dueAt == null || CLOSED[task.status]) return false;
  return ms(nowISO) > ms(task.dueAt) + 4 * 3600000;
}

function overdueTasks(store, nowISO) {
  return store.tasks.filter(function (t) { return isOverdue(t, nowISO); })
    .sort(function (x, y) {
      if (x.dueAt !== y.dueAt) return ms(x.dueAt) - ms(y.dueAt);
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });
}

/* ---------- REQ-05 — search ---------- */

var FIELDS = { status: 1, owner: 1, tag: 1 };

function tokenize(query) {
  var out = [], i = 0, s = String(query == null ? '' : query);
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    var neg = false;
    if (s[i] === '-') { neg = true; i++; }
    var buf = '';
    while (i < s.length && !/\s/.test(s[i])) {
      if (s[i] === '"') {
        i++;
        while (i < s.length && s[i] !== '"') { buf += s[i]; i++; }
        i++;
      } else { buf += s[i]; i++; }
    }
    if (buf !== '') out.push({ neg: neg, raw: buf });
  }
  return out;
}

function normStatus(v) { return String(v).toUpperCase().replace(/-/g, '_'); }
function normOwner(v) { return String(v == null ? '' : v).toLowerCase().replace(/^@/, ''); }

function classify(tok) {
  var m = /^([a-zA-Z]+):(.*)$/.exec(tok.raw);
  if (m && FIELDS[m[1].toLowerCase()]) {
    return { neg: tok.neg, kind: m[1].toLowerCase(), value: m[2] };
  }
  var c = /^priority([<>])(\d+)$/.exec(tok.raw);
  if (c) return { neg: tok.neg, kind: 'priority', op: c[1], n: parseInt(c[2], 10) };
  var d = /^due([<>])(\d+)d$/.exec(tok.raw);
  if (d) return { neg: tok.neg, kind: 'due', op: d[1], n: parseInt(d[2], 10) };
  return { neg: tok.neg, kind: 'term', value: tok.raw };
}

function matchToken(task, tk, nowISO) {
  switch (tk.kind) {
    case 'status': return task.status === normStatus(tk.value);
    case 'owner':  return normOwner(task.owner) === normOwner(tk.value) && task.owner != null;
    case 'tag':    return task.tags.some(function (t) { return String(t).toLowerCase() === String(tk.value).toLowerCase(); });
    case 'priority': {
      var p = priorityScore(task, nowISO);
      return tk.op === '>' ? p > tk.n : p < tk.n;
    }
    case 'due': {
      if (task.dueAt == null) return false;
      var h = hoursUntil(task.dueAt, nowISO);
      return tk.op === '<' ? (h >= 0 && h < tk.n * 24) : (h > tk.n * 24);
    }
    default: {
      var needle = String(tk.value).toLowerCase();
      return String(task.title).toLowerCase().indexOf(needle) !== -1 ||
             String(task.description).toLowerCase().indexOf(needle) !== -1;
    }
  }
}

function searchTasks(store, query, nowISO) {
  var toks = tokenize(query).map(classify);
  if (toks.length === 0) {
    return canonicalSort(store.tasks.filter(function (t) { return t.status !== 'ARCHIVED'; }), nowISO);
  }
  var pos = toks.filter(function (t) { return !t.neg; });
  var neg = toks.filter(function (t) { return t.neg; });

  // positive tokens grouped by field; same field ORs, different fields AND.
  var groups = {};
  pos.forEach(function (t) {
    var key = t.kind === 'term' ? 'term:' + t.value : t.kind;
    (groups[key] = groups[key] || []).push(t);
  });

  var asksArchived = pos.some(function (t) { return t.kind === 'status' && normStatus(t.value) === 'ARCHIVED'; });

  var res = store.tasks.filter(function (task) {
    if (task.status === 'ARCHIVED' && !asksArchived) return false;
    for (var k in groups) {
      if (!groups[k].some(function (t) { return matchToken(task, t, nowISO); })) return false;
    }
    for (var i = 0; i < neg.length; i++) {
      if (matchToken(task, neg[i], nowISO)) return false;
    }
    return true;
  });
  return canonicalSort(res, nowISO);
}

/* ---------- filter ---------- */

function filterTasks(store, criteria, nowISO) {
  var c = criteria || {};
  var wanted = null;
  if (c.statuses) wanted = c.statuses.map(normStatus);
  else if (c.status) wanted = [normStatus(c.status)];

  var res = store.tasks.filter(function (t) {
    if (wanted) { if (wanted.indexOf(t.status) === -1) return false; }
    else if (t.status === 'ARCHIVED') return false;
    if (c.owner != null && normOwner(t.owner) !== normOwner(c.owner)) return false;
    if (c.tag != null && !t.tags.some(function (x) { return String(x).toLowerCase() === String(c.tag).toLowerCase(); })) return false;
    if (Array.isArray(c.tags) && !c.tags.every(function (need) {
      return t.tags.some(function (x) { return String(x).toLowerCase() === String(need).toLowerCase(); });
    })) return false;
    if (c.overdue != null && isOverdue(t, nowISO) !== !!c.overdue) return false;
    var p = priorityScore(t, nowISO);
    if (c.minPriority != null && p < c.minPriority) return false;
    if (c.maxPriority != null && p > c.maxPriority) return false;
    if (c.dueBefore != null && (t.dueAt == null || ms(t.dueAt) >= ms(c.dueBefore))) return false;
    if (c.dueAfter != null && (t.dueAt == null || ms(t.dueAt) <= ms(c.dueAfter))) return false;
    return true;
  });
  return canonicalSort(res, nowISO);
}

/* ---------- REQ-06 — workload + notifications ---------- */

function taskLoad(task, nowISO) {
  if (CLOSED[task.status]) return 0;
  var base = priorityScore(task, nowISO) / 10;
  if (task.status === 'IN_PROGRESS') base = base * 1.5;
  if (task.status === 'BLOCKED') base = base * 0.25;
  if (isOverdue(task, nowISO)) base = base + 2;
  return base;
}

function userWorkload(store, owner, nowISO) {
  var key = normOwner(owner);
  var sum = 0;
  store.tasks.forEach(function (t) {
    if (t.owner != null && normOwner(t.owner) === key) sum += taskLoad(t, nowISO);
  });
  if (sum > 40) sum = 40;
  return Math.round(sum * 100) / 100;
}

function deadlineNotifications(store, nowISO) {
  var out = [];
  store.tasks.forEach(function (t) {
    if (t.dueAt == null || CLOSED[t.status]) return;
    var h = hoursUntil(t.dueAt, nowISO);
    var kind = null;
    if (h <= 0) { if (isOverdue(t, nowISO)) kind = 'OVERDUE'; }
    else if (h <= 24) kind = 'T_MINUS_24H';
    else if (h <= 72) kind = 'T_MINUS_72H';
    else if (h <= 168) kind = 'T_MINUS_7D';
    if (kind) out.push({ taskId: t.id, owner: t.owner, kind: kind, dueAt: t.dueAt });
  });

  var loads = {};
  out.forEach(function (n) {
    var k = normOwner(n.owner);
    if (!(k in loads)) loads[k] = userWorkload(store, n.owner == null ? '' : n.owner, nowISO);
  });

  return out.filter(function (n) {
    var load = loads[normOwner(n.owner)];
    if (load >= 30) return n.kind === 'OVERDUE' || n.kind === 'T_MINUS_24H';
    return true;
  }).sort(function (x, y) {
    if (x.dueAt !== y.dueAt) return ms(x.dueAt) - ms(y.dueAt);
    return x.taskId < y.taskId ? -1 : x.taskId > y.taskId ? 1 : 0;
  });
}

var API = {
  HOLIDAYS: HOLIDAYS, TRANSITIONS: TRANSITIONS,
  hoursBetween: hoursBetween, hoursUntil: hoursUntil, isBusinessDay: isBusinessDay,
  rollDeadline: rollDeadline, businessDaysBetween: businessDaysBetween,
  encodeTaskId: encodeTaskId, decodeTaskId: decodeTaskId,
  priorityScore: priorityScore, canonicalSort: canonicalSort,
  createStore: createStore, createTask: createTask, getTask: getTask,
  updateTask: updateTask, deleteTask: deleteTask, setDeadline: setDeadline,
  transition: transition, completeTask: completeTask,
  isOverdue: isOverdue, overdueTasks: overdueTasks,
  tokenize: tokenize, searchTasks: searchTasks, filterTasks: filterTasks,
  taskLoad: taskLoad, userWorkload: userWorkload, deadlineNotifications: deadlineNotifications
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.TASKFLOW_REF = API;
