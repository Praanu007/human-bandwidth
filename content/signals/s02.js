/* content/signals/s02.js — SIGNAL-02 DRIFT — recovers REQ-02 (priority score + canonical order) */
HB.registerSignal({
  id: 'SIGNAL-02',
  index: 2,
  codename: 'DRIFT',
  points: 100,
  estMinutes: 12,
  tagline: 'The scorer left its arithmetic behind.',

  /* ---------------- PHASE 1: INVESTIGATION ---------------- */

  briefing: [
    'TASKFLOW re-scored every task it held on a fixed cadence and wrote one row per task into a scoring audit. The document that described the arithmetic is gone. The audit is not.',
    'Three fragments came off scoring-host-2: the operator note explaining how the last dump was blocked out, the dump itself — 49 rows, all scored against one pinned clock — and a queue render showing the order a scored page was emitted in.',
    'The dump is not live traffic. The rescore harness walked one input at a time and held the rest flat, so each block isolates one term. The `score` column is the integer the scorer stored, not a rendered value.',
    'The batch faulted on its last row. That task was read, never scored, and requeued; it sits in `pending.row`. Recover the arithmetic, then finish the row.'
  ],

  artifacts: [
    {
      name: 'audit-blocks.txt',
      kind: 'log',
      body: [
        'scoring-host-2 :: forensic note :: attached to dump 0314-0300',
        '-------------------------------------------------------------',
        'scorer clock, pinned for the whole dump:  2026-03-14T12:00:00Z',
        'every row below was scored against that instant. no row uses any other clock.',
        '',
        'columns',
        '  blk         which sweep the row came from',
        '  u  i  b     the urgency, impact and blocking counters as stored on the task',
        '              urgency and impact are range-checked to 0..5 on write.',
        '              blocking is only checked for >= 0 on write, then stored raw.',
        '  status      task status at score time',
        '  created_at  when the task was created',
        '  due_at      deadline. a dash means the task has none.',
        '  score       what the scorer stored. every row stores an integer.',
        '',
        'sweeps',
        '  A   fresh tasks, no deadline, status OPEN. only u / i / b move.',
        '  B   no deadline, status OPEN, u pinned at 1. only created_at moves.',
        '      the last B row is the drift case: the host booted with a skewed RTC and',
        '      stamped a task ahead of the clock. the scorer took it anyway.',
        '  C   fresh tasks, status OPEN, u pinned at 2. only due_at moves.',
        '      timestamps were picked in pairs one hour apart, deliberately straddling',
        '      the points where the stored score stops moving smoothly.',
        '  D   status sweep. the first eight rows differ only in status.',
        '      the last four are rows carried in from the other sweeps and re-run.',
        '',
        'no row in this dump was edited after the fact.'
      ].join('\n')
    },
    {
      name: 'score-audit.tsv',
      kind: 'table',
      body: [
        'blk\tu\ti\tb\tstatus\tcreated_at\tdue_at\tscore',
        'A\t0\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t-\t0',
        'A\t1\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t-\t5',
        'A\t3\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t-\t15',
        'A\t5\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t-\t25',
        'A\t0\t1\t0\tOPEN\t2026-03-14T12:00:00Z\t-\t3',
        'A\t0\t4\t0\tOPEN\t2026-03-14T12:00:00Z\t-\t12',
        'A\t0\t0\t1\tOPEN\t2026-03-14T12:00:00Z\t-\t2',
        'A\t0\t0\t4\tOPEN\t2026-03-14T12:00:00Z\t-\t8',
        'A\t0\t0\t5\tOPEN\t2026-03-14T12:00:00Z\t-\t10',
        'A\t0\t0\t6\tOPEN\t2026-03-14T12:00:00Z\t-\t10',
        'A\t0\t0\t9\tOPEN\t2026-03-14T12:00:00Z\t-\t10',
        'A\t2\t3\t1\tOPEN\t2026-03-14T12:00:00Z\t-\t21',
        'A\t5\t5\t5\tOPEN\t2026-03-14T12:00:00Z\t-\t50',
        'B\t1\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t-\t5',
        'B\t1\t0\t0\tOPEN\t2026-03-13T13:00:00Z\t-\t5',
        'B\t1\t0\t0\tOPEN\t2026-03-13T12:00:00Z\t-\t6',
        'B\t1\t0\t0\tOPEN\t2026-03-13T00:00:00Z\t-\t6',
        'B\t1\t0\t0\tOPEN\t2026-03-12T12:00:00Z\t-\t7',
        'B\t1\t0\t0\tOPEN\t2026-03-07T12:00:00Z\t-\t12',
        'B\t1\t0\t0\tOPEN\t2026-03-04T12:00:00Z\t-\t15',
        'B\t1\t0\t0\tOPEN\t2026-03-03T12:00:00Z\t-\t15',
        'B\t1\t0\t0\tOPEN\t2026-02-12T12:00:00Z\t-\t15',
        'B\t1\t0\t0\tOPEN\t2026-03-14T18:00:00Z\t-\t5',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t-\t10',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-24T12:00:00Z\t10',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-21T13:00:00Z\t10',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-21T12:00:00Z\t13',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-18T12:00:00Z\t13',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-17T13:00:00Z\t13',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-17T12:00:00Z\t18',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-16T12:00:00Z\t18',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-15T13:00:00Z\t18',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-15T12:00:00Z\t25',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-14T13:00:00Z\t25',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-14T12:00:00Z\t35',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-13T12:00:00Z\t35',
        'C\t2\t0\t0\tOPEN\t2026-03-14T12:00:00Z\t2026-03-01T12:00:00Z\t35',
        'D\t3\t1\t0\tDRAFT\t2026-03-14T12:00:00Z\t-\t18',
        'D\t3\t1\t0\tOPEN\t2026-03-14T12:00:00Z\t-\t18',
        'D\t3\t1\t0\tIN_PROGRESS\t2026-03-14T12:00:00Z\t-\t18',
        'D\t3\t1\t0\tIN_REVIEW\t2026-03-14T12:00:00Z\t-\t18',
        'D\t3\t1\t0\tBLOCKED\t2026-03-14T12:00:00Z\t-\t9',
        'D\t3\t1\t0\tDONE\t2026-03-14T12:00:00Z\t-\t0',
        'D\t3\t1\t0\tCANCELLED\t2026-03-14T12:00:00Z\t-\t0',
        'D\t3\t1\t0\tARCHIVED\t2026-03-14T12:00:00Z\t-\t0',
        'D\t3\t0\t0\tBLOCKED\t2026-03-14T12:00:00Z\t-\t7',
        'D\t2\t0\t0\tBLOCKED\t2026-03-14T12:00:00Z\t2026-03-14T13:00:00Z\t12',
        'D\t1\t0\t0\tBLOCKED\t2026-02-12T12:00:00Z\t-\t7',
        'D\t5\t5\t5\tDONE\t2026-02-12T12:00:00Z\t2026-03-13T12:00:00Z\t0'
      ].join('\n')
    },
    {
      name: 'queue-render.log',
      kind: 'log',
      body: [
        'taskflow-web :: queue.render :: clock=2026-03-14T12:00:00Z',
        'nine tasks, one page. the fixture handed them to the queue builder in a shuffled',
        'order; below is the order the builder emitted. scores are the stored ones.',
        '',
        'pos  id        score  u  i  b  status   created_at            due_at',
        '  1  TF-0004G     25  5  0  0  OPEN     2026-03-14T12:00:00Z  -',
        '  2  TF-0007J     18  2  0  0  OPEN     2026-03-14T12:00:00Z  2026-03-16T12:00:00Z',
        '  3  TF-0009L     18  2  0  0  OPEN     2026-03-14T12:00:00Z  2026-03-17T00:00:00Z',
        '  4  TF-000CV     18  3  0  0  OPEN     2026-03-14T12:00:00Z  2026-03-19T12:00:00Z',
        '  5  TF-000FY     18  1  1  0  OPEN     2026-03-04T12:00:00Z  -',
        '  6  TF-0006I     18  3  1  0  OPEN     2026-03-14T12:00:00Z  -',
        '  7  TF-000J2     18  3  1  0  OPEN     2026-03-14T12:00:00Z  -',
        '  8  TF-000N6      9  3  1  0  BLOCKED  2026-03-14T12:00:00Z  -',
        '  9  TF-000RA      0  5  5  5  DONE     2026-03-14T12:00:00Z  2026-03-13T12:00:00Z',
        '',
        'the builder is deterministic: these nine tasks in any input order render in',
        'exactly this sequence. positions 6 and 7 differ in nothing but the id column.'
      ].join('\n')
    },
    {
      name: 'pending.row',
      kind: 'log',
      body: [
        'scoring-host-2 :: batch 0314-0300 :: pending.row',
        'worker faulted after reading this task and before writing its score.',
        'the task was requeued and has not been re-scored since.',
        '',
        '  clock       2026-03-14T12:00:00Z',
        '  u           4',
        '  i           3',
        '  b           7',
        '  status      BLOCKED',
        '  created_at  2026-03-01T12:00:00Z',
        '  due_at      2026-03-17T12:00:00Z',
        '  score       <never written>'
      ].join('\n')
    }
  ],

  probe: {
    question: 'The batch died before scoring `pending.row`. What integer would the scorer have stored for it?',
    kind: 'input',
    choices: null,
    answer: 28,
    normalize: 'number',
    whiff: 'Not what the scorer would have written. That row sits on three of the awkward points in the dump at once — its b, its age, and exactly which side of a step its due_at falls on — and the block D rule lands on the total after all three.'
  },

  /* ---------------- PHASE 2: IMPLEMENTATION ---------------- */

  task: [
    'Rebuild the scorer and the queue builder from the audit.',
    '`scoreOf(task, nowISO)` takes a task carrying `urgency`, `impact`, `blocking`, `status`, `createdAt` and `dueAt` (nullable) and returns the integer the audit would have stored for it. Assume `urgency` and `impact` arrive already range-checked to 0..5; `blocking` arrives as any integer >= 0, exactly as the dump shows it.',
    '`rankTasks(tasks, nowISO)` returns an array of task ids in the order the queue render emitted them. It must not disturb the array it was handed.',
    'Every timestamp is an ISO-8601 UTC string. `nowISO` is the only clock — nothing may read the wall clock.'
  ],
  exports: ['scoreOf', 'rankTasks'],
  starter: [
    '/* The scorer clock is always passed in. Never call Date.now(). */',
    '',
    'function hoursBetween(aISO, bISO) {',
    '  return (Date.parse(bISO) - Date.parse(aISO)) / 3600000;',
    '}',
    '',
    'function scoreOf(task, nowISO) {',
    '  // base off the three counters, plus the age term, plus the deadline term,',
    '  // then whatever the status sweep says happens last.',
    '  return 0;',
    '}',
    '',
    'function rankTasks(tasks, nowISO) {',
    '  // sort a copy; hand back ids.',
    '  return [];',
    '}',
    ''
  ].join('\n'),

  tests: [
    {
      name: 'counter weights and their sum',
      visible: true,
      src: [
        'var NOW = "2026-03-14T12:00:00Z";',
        'var mk = function (o) {',
        '  var t = { id: "TF-0001D", urgency: 0, impact: 0, blocking: 0, status: "OPEN", createdAt: NOW, dueAt: null };',
        '  for (var k in o) { t[k] = o[k]; }',
        '  return t;',
        '};',
        'assertEqual(scoreOf(mk({}), NOW), 0, "empty task");',
        'assertEqual(scoreOf(mk({ urgency: 1 }), NOW), 5, "urgency 1");',
        'assertEqual(scoreOf(mk({ impact: 1 }), NOW), 3, "impact 1");',
        'assertEqual(scoreOf(mk({ blocking: 1 }), NOW), 2, "blocking 1");',
        'assertEqual(scoreOf(mk({ urgency: 2, impact: 3, blocking: 1 }), NOW), 21, "mixed");',
        'assertEqual(scoreOf(mk({ urgency: 5, impact: 5, blocking: 5 }), NOW), 50, "all five");'
      ].join('\n')
    },
    {
      name: 'age pays by the whole day',
      visible: true,
      src: [
        'var NOW = "2026-03-14T12:00:00Z";',
        'var aged = function (createdAt) {',
        '  return { id: "TF-0001D", urgency: 1, impact: 0, blocking: 0, status: "OPEN", createdAt: createdAt, dueAt: null };',
        '};',
        'assertEqual(scoreOf(aged("2026-03-14T12:00:00Z"), NOW), 5, "brand new");',
        'assertEqual(scoreOf(aged("2026-03-13T13:00:00Z"), NOW), 5, "23h old");',
        'assertEqual(scoreOf(aged("2026-03-13T12:00:00Z"), NOW), 6, "24h old");',
        'assertEqual(scoreOf(aged("2026-03-13T00:00:00Z"), NOW), 6, "36h old");',
        'assertEqual(scoreOf(aged("2026-03-12T12:00:00Z"), NOW), 7, "48h old");',
        'assertEqual(scoreOf(aged("2026-03-07T12:00:00Z"), NOW), 12, "7 days old");'
      ].join('\n')
    },
    {
      name: 'the deadline term',
      visible: true,
      src: [
        'var NOW = "2026-03-14T12:00:00Z";',
        'var due = function (dueAt) {',
        '  return { id: "TF-0001D", urgency: 2, impact: 0, blocking: 0, status: "OPEN", createdAt: NOW, dueAt: dueAt };',
        '};',
        'assertEqual(scoreOf(due(null), NOW), 10, "no deadline");',
        'assertEqual(scoreOf(due("2026-03-24T12:00:00Z"), NOW), 10, "10 days out");',
        'assertEqual(scoreOf(due("2026-03-18T12:00:00Z"), NOW), 13, "96h out");',
        'assertEqual(scoreOf(due("2026-03-16T12:00:00Z"), NOW), 18, "48h out");',
        'assertEqual(scoreOf(due("2026-03-14T13:00:00Z"), NOW), 25, "1h out");',
        'assertEqual(scoreOf(due("2026-03-13T12:00:00Z"), NOW), 35, "a day overdue");'
      ].join('\n')
    },
    {
      name: 'rankTasks puts the strongest score first',
      visible: true,
      src: [
        'var NOW = "2026-03-14T12:00:00Z";',
        'var mk = function (o) {',
        '  var t = { id: "TF-0001D", urgency: 0, impact: 0, blocking: 0, status: "OPEN", createdAt: NOW, dueAt: null };',
        '  for (var k in o) { t[k] = o[k]; }',
        '  return t;',
        '};',
        'var queue = [',
        '  mk({ id: "TF-000N6", urgency: 3, impact: 1, status: "BLOCKED" }),',
        '  mk({ id: "TF-000RA", urgency: 5, impact: 5, blocking: 5, status: "DONE", dueAt: "2026-03-13T12:00:00Z" }),',
        '  mk({ id: "TF-0004G", urgency: 5 }),',
        '  mk({ id: "TF-0007J", urgency: 2, dueAt: "2026-03-16T12:00:00Z" })',
        '];',
        'assertDeep(rankTasks(queue, NOW), ["TF-0004G", "TF-0007J", "TF-000N6", "TF-000RA"]);'
      ].join('\n')
    },
    {
      name: 'deadline steps land on their upper edge',
      visible: false,
      src: [
        'var NOW = "2026-03-14T12:00:00Z";',
        'var due = function (dueAt) {',
        '  return { id: "TF-0001D", urgency: 2, impact: 0, blocking: 0, status: "OPEN", createdAt: NOW, dueAt: dueAt };',
        '};',
        'assertEqual(scoreOf(due("2026-03-21T13:00:00Z"), NOW), 10, "169h");',
        'assertEqual(scoreOf(due("2026-03-21T12:00:00Z"), NOW), 13, "168h");',
        'assertEqual(scoreOf(due("2026-03-17T13:00:00Z"), NOW), 13, "73h");',
        'assertEqual(scoreOf(due("2026-03-17T12:00:00Z"), NOW), 18, "72h");',
        'assertEqual(scoreOf(due("2026-03-15T13:00:00Z"), NOW), 18, "25h");',
        'assertEqual(scoreOf(due("2026-03-15T12:00:00Z"), NOW), 25, "24h");',
        'assertEqual(scoreOf(due("2026-03-14T12:00:00Z"), NOW), 35, "due exactly now");',
        'assertEqual(scoreOf(due("2026-03-01T12:00:00Z"), NOW), 35, "long overdue");'
      ].join('\n')
    },
    {
      name: 'BLOCKED halves the finished total, never rounding up',
      visible: false,
      src: [
        'var NOW = "2026-03-14T12:00:00Z";',
        'var mk = function (o) {',
        '  var t = { id: "TF-0001D", urgency: 0, impact: 0, blocking: 0, status: "BLOCKED", createdAt: NOW, dueAt: null };',
        '  for (var k in o) { t[k] = o[k]; }',
        '  return t;',
        '};',
        'assertEqual(scoreOf(mk({}), NOW), 0, "nothing to halve");',
        'assertEqual(scoreOf(mk({ urgency: 3, impact: 1 }), NOW), 9, "18 halved");',
        'assertEqual(scoreOf(mk({ urgency: 3 }), NOW), 7, "15 halved, truncated");',
        'assertEqual(scoreOf(mk({ urgency: 2, dueAt: "2026-03-14T13:00:00Z" }), NOW), 12, "deadline term is inside the halving");',
        'assertEqual(scoreOf(mk({ urgency: 1, createdAt: "2026-02-12T12:00:00Z" }), NOW), 7, "age term is inside the halving");',
        'assertEqual(scoreOf(mk({ urgency: 5, impact: 5, blocking: 5, createdAt: "2026-02-12T12:00:00Z", dueAt: "2026-03-13T12:00:00Z" }), NOW), 42, "85 halved, truncated");'
      ].join('\n')
    },
    {
      name: 'closed statuses zero out, the rest score normally',
      visible: false,
      src: [
        'var NOW = "2026-03-14T12:00:00Z";',
        'var loaded = function (status) {',
        '  return { id: "TF-0001D", urgency: 5, impact: 5, blocking: 5, status: status, createdAt: "2026-02-12T12:00:00Z", dueAt: "2026-03-13T12:00:00Z" };',
        '};',
        'var plain = function (status) {',
        '  return { id: "TF-0001D", urgency: 3, impact: 1, blocking: 0, status: status, createdAt: NOW, dueAt: null };',
        '};',
        'assertEqual(scoreOf(loaded("OPEN"), NOW), 85, "the score being thrown away");',
        'assertEqual(scoreOf(loaded("DONE"), NOW), 0, "DONE");',
        'assertEqual(scoreOf(loaded("CANCELLED"), NOW), 0, "CANCELLED");',
        'assertEqual(scoreOf(loaded("ARCHIVED"), NOW), 0, "ARCHIVED");',
        'assertEqual(scoreOf(plain("DRAFT"), NOW), 18, "DRAFT");',
        'assertEqual(scoreOf(plain("IN_PROGRESS"), NOW), 18, "IN_PROGRESS");',
        'assertEqual(scoreOf(plain("IN_REVIEW"), NOW), 18, "IN_REVIEW");'
      ].join('\n')
    },
    {
      name: 'the two ceilings and the backwards clock',
      visible: false,
      src: [
        'var NOW = "2026-03-14T12:00:00Z";',
        'var mk = function (o) {',
        '  var t = { id: "TF-0001D", urgency: 0, impact: 0, blocking: 0, status: "OPEN", createdAt: NOW, dueAt: null };',
        '  for (var k in o) { t[k] = o[k]; }',
        '  return t;',
        '};',
        'assertEqual(scoreOf(mk({ blocking: 4 }), NOW), 8, "under the ceiling");',
        'assertEqual(scoreOf(mk({ blocking: 5 }), NOW), 10, "at the ceiling");',
        'assertEqual(scoreOf(mk({ blocking: 6 }), NOW), 10, "one over");',
        'assertEqual(scoreOf(mk({ blocking: 9 }), NOW), 10, "far over");',
        'assertEqual(scoreOf(mk({ urgency: 1, impact: 1, blocking: 12 }), NOW), 18, "ceiling inside a sum");',
        'assertEqual(scoreOf(mk({ urgency: 1, createdAt: "2026-03-04T12:00:00Z" }), NOW), 15, "10 days old");',
        'assertEqual(scoreOf(mk({ urgency: 1, createdAt: "2026-03-03T12:00:00Z" }), NOW), 15, "11 days old");',
        'assertEqual(scoreOf(mk({ urgency: 1, createdAt: "2026-02-12T12:00:00Z" }), NOW), 15, "30 days old");',
        'assertEqual(scoreOf(mk({ urgency: 1, createdAt: "2026-03-14T18:00:00Z" }), NOW), 5, "stamped 6h ahead");',
        'assertEqual(scoreOf(mk({ urgency: 1, createdAt: "2026-04-13T12:00:00Z" }), NOW), 5, "stamped 30 days ahead");'
      ].join('\n')
    },
    {
      name: 'rankTasks resolves every tie the render shows',
      visible: false,
      src: [
        'var NOW = "2026-03-14T12:00:00Z";',
        'var mk = function (o) {',
        '  var t = { id: "TF-0001D", urgency: 0, impact: 0, blocking: 0, status: "OPEN", createdAt: NOW, dueAt: null };',
        '  for (var k in o) { t[k] = o[k]; }',
        '  return t;',
        '};',
        'var page = [',
        '  mk({ id: "TF-000J2", urgency: 3, impact: 1 }),',
        '  mk({ id: "TF-000RA", urgency: 5, impact: 5, blocking: 5, status: "DONE", dueAt: "2026-03-13T12:00:00Z" }),',
        '  mk({ id: "TF-0009L", urgency: 2, dueAt: "2026-03-17T00:00:00Z" }),',
        '  mk({ id: "TF-0006I", urgency: 3, impact: 1 }),',
        '  mk({ id: "TF-000CV", urgency: 3, dueAt: "2026-03-19T12:00:00Z" }),',
        '  mk({ id: "TF-000N6", urgency: 3, impact: 1, status: "BLOCKED" }),',
        '  mk({ id: "TF-000FY", urgency: 1, impact: 1, createdAt: "2026-03-04T12:00:00Z" }),',
        '  mk({ id: "TF-0004G", urgency: 5 }),',
        '  mk({ id: "TF-0007J", urgency: 2, dueAt: "2026-03-16T12:00:00Z" })',
        '];',
        'assertDeep(rankTasks(page, NOW), [',
        '  "TF-0004G", "TF-0007J", "TF-0009L", "TF-000CV", "TF-000FY",',
        '  "TF-0006I", "TF-000J2", "TF-000N6", "TF-000RA"',
        ']);'
      ].join('\n')
    },
    {
      name: 'rankTasks yields ids and leaves the caller array alone',
      visible: false,
      src: [
        'var NOW = "2026-03-14T12:00:00Z";',
        'var mk = function (o) {',
        '  var t = { id: "TF-0001D", urgency: 0, impact: 0, blocking: 0, status: "OPEN", createdAt: NOW, dueAt: null };',
        '  for (var k in o) { t[k] = o[k]; }',
        '  return t;',
        '};',
        'var slow = mk({ id: "TF-0007J", urgency: 2, dueAt: "2026-03-16T12:00:00Z" });',
        'var hot = mk({ id: "TF-0004G", urgency: 5 });',
        'var input = [slow, hot];',
        'var out = rankTasks(input, NOW);',
        'assertDeep(out, ["TF-0004G", "TF-0007J"], "ranked ids");',
        'assert(out !== input, "must not hand back the array it was given");',
        'assertEqual(input.length, 2, "input length untouched");',
        'assertEqual(input[0], slow, "input order untouched");',
        'assertEqual(input[1], hot, "input order untouched");',
        'assertEqual(typeof out[0], "string", "ids, not task objects");',
        'assertDeep(rankTasks([], NOW), [], "empty page");'
      ].join('\n')
    }
  ],

  hints: [
    {
      cost: 30,
      text: 'Block A is three sweeps braided together: hold two counters at zero and the third one reads its own worth straight off the score column. Do the same one-variable reading for B and C before you try to explain any row that mixes terms — and check that the terms simply add, using the rows that move two things at once.'
    },
    {
      cost: 30,
      text: 'Three places in the dump are not smooth. In A, `b` stops paying past a point. In B, `created_at` stops paying past a point, and the drift row shows what the scorer does when the age comes out negative. In C, `due_at` pays in flat steps — the pairs of rows one hour apart tell you which side of each step is which. Block D is applied last, to the whole total: compare the two BLOCKED rows whose unhalved totals are odd numbers.'
    }
  ],

  /* ---------------- PHASE 3: REVEAL ---------------- */

  reveal: {
    reqId: 'REQ-02',
    title: 'Priority score and canonical ordering',
    body: [
      'Fields used: `urgency` (int 0-5), `impact` (int 0-5), `blocking` (int >= 0), `createdAt`, `dueAt` (nullable), `status`. All times are ISO-8601 UTC and the clock is always passed in.',
      'base = 5*urgency + 3*impact + 2*Math.min(blocking, 5). urgency and impact are clamped into 0..5 on write; blocking is clamped only to >= 0 on write, so the min(…, 5) ceiling lives inside the score.',
      'ageDays = Math.floor(hoursBetween(createdAt, now) / 24); ageBonus = Math.min(Math.max(ageDays, 0), 10). Whole days only — 23h of age is worth nothing, 24h is worth 1. Never negative (a createdAt ahead of the clock scores 0 age) and never above 10.',
      'dueFactor is 0 when dueAt is null. Otherwise, with h = hoursUntil(dueAt, now): h <= 0 -> 25; h <= 24 -> 15; h <= 72 -> 8; h <= 168 -> 3; otherwise 0. Every band is inclusive at its upper edge: exactly 24h scores 15, a minute past 24h scores 8, exactly 168h scores 3, past 168h scores nothing.',
      'raw = base + ageBonus + dueFactor. If status is BLOCKED, raw = raw * 0.5 — applied to the whole total, after the age and deadline terms are in. Then score = Math.min(100, Math.floor(raw)): the result is always floored, never rounded, so a halved odd total loses the half.',
      'If status is DONE, CANCELLED or ARCHIVED the score is 0 whatever the other fields say. DRAFT, OPEN, IN_PROGRESS and IN_REVIEW score normally; only BLOCKED is halved.',
      'Canonical ordering — used by search, by filter and by every sorted output in the system: `score` DESC, then `dueAt` ASC with nulls LAST, then `createdAt` ASC, then `id` ASC by plain string comparison.'
    ]
  },

  reference: [
    'var CLOSED_STATUS = { DONE: true, CANCELLED: true, ARCHIVED: true };',
    '',
    'function hoursBetween(aISO, bISO) {',
    '  return (Date.parse(bISO) - Date.parse(aISO)) / 3600000;',
    '}',
    '',
    'function scoreOf(task, nowISO) {',
    '  if (CLOSED_STATUS[task.status]) return 0;',
    '  var base = 5 * task.urgency + 3 * task.impact + 2 * Math.min(task.blocking, 5);',
    '  var ageDays = Math.floor(hoursBetween(task.createdAt, nowISO) / 24);',
    '  var ageBonus = Math.min(Math.max(ageDays, 0), 10);',
    '  var dueFactor = 0;',
    '  if (task.dueAt != null) {',
    '    var h = hoursBetween(nowISO, task.dueAt);',
    '    dueFactor = h <= 0 ? 25 : h <= 24 ? 15 : h <= 72 ? 8 : h <= 168 ? 3 : 0;',
    '  }',
    '  var raw = base + ageBonus + dueFactor;',
    '  if (task.status === "BLOCKED") raw = raw * 0.5;',
    '  return Math.min(100, Math.floor(raw));',
    '}',
    '',
    'function rankTasks(tasks, nowISO) {',
    '  return tasks.slice().sort(function (x, y) {',
    '    var sx = scoreOf(x, nowISO), sy = scoreOf(y, nowISO);',
    '    if (sx !== sy) return sy - sx;',
    '    if (x.dueAt == null && y.dueAt != null) return 1;',
    '    if (y.dueAt == null && x.dueAt != null) return -1;',
    '    if (x.dueAt != null && y.dueAt != null && x.dueAt !== y.dueAt) {',
    '      return Date.parse(x.dueAt) - Date.parse(y.dueAt);',
    '    }',
    '    if (x.createdAt !== y.createdAt) return Date.parse(x.createdAt) - Date.parse(y.createdAt);',
    '    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;',
    '  }).map(function (t) { return t.id; });',
    '}',
    ''
  ].join('\n')
});
