/* content/signals/s05.js — SIGNAL-05 "GREP" — recovers REQ-05 (search grammar). */
HB.registerSignal({
  id: 'SIGNAL-05',
  index: 5,
  codename: 'GREP',
  points: 100,
  estMinutes: 15,
  tagline: 'Rebuild the query grammar from hits.',

  /* ---- PHASE 1: INVESTIGATION ---- */
  briefing: [
    'The TASKFLOW search endpoint was the one subsystem still running with verbose logging ' +
    'when the box was pulled. Salvage recovered three files: a snapshot of the task store ' +
    'taken at `2026-03-16T09:00:00Z`, the text index that fed the matcher, and the search ' +
    'audit log.',

    'No parser source survived. No help text, no fixtures, no grammar file. What survives is ' +
    'behaviour: 37 accepted queries, the token count the planner derived for each (`ntok`), ' +
    'and the ids it returned, in result order, against eleven tasks that did not change during ' +
    'the capture window.',

    'The `score` column of the snapshot is the REQ-02 priority already resolved at the capture ' +
    'instant — the matcher compared against exactly those numbers, so take them as given. ' +
    'Result ordering is the REQ-02 canonical ordering and is not part of this signal; only ' +
    'membership matters here.',

    'Recover the grammar. What counts as one token. Which prefixes the planner accepts as ' +
    'field filters and in what exact form. What it does with the prefixes it does not accept. ' +
    'How each field normalises its value. How several tokens combine into one result set.'
  ],

  artifacts: [
    {
      name: 'store-snapshot.tsv',
      kind: 'table',
      body:
        'id\tstatus\towner\ttags\tdueAt\tscore\n' +
        'TF-0001D\tIN_PROGRESS\t@Ana\tapi;fast-track\t2026-03-17T17:00:00Z\t49\n' +
        'TF-0002E\tOPEN\tana\tinfra\t2026-03-18T12:00:00Z\t39\n' +
        'TF-0003F\tOPEN\tBo\tdocs\tnull\t15\n' +
        'TF-0004G\tOPEN\tbo\tinfra;needs triage\t2026-03-20T17:00:00Z\t44\n' +
        'TF-0005H\tIN_REVIEW\t@CAI\tci\t2026-03-17T09:00:00Z\t44\n' +
        'TF-0006I\tBLOCKED\t@ana\tops\t2026-04-10T17:00:00Z\t13\n' +
        'TF-0007J\tOPEN\tcai\tops\tnull\t20\n' +
        'TF-0008K\tDONE\tbo\tinfra\t2026-03-13T17:00:00Z\t0\n' +
        'TF-0009L\tOPEN\t@Ana\tinfra\t2026-03-25T17:00:00Z\t26\n' +
        'TF-000AT\tARCHIVED\tcai\tbilling\t2026-03-11T17:00:00Z\t0\n' +
        'TF-000BU\tOPEN\tbo\tops\t2026-03-12T17:00:00Z\t53'
    },
    {
      name: 'text-index.log',
      kind: 'log',
      body:
        'TF-0001D  title  Cold start latency on ingest\n' +
        'TF-0001D  desc   Queue drains slowly after redeploy. project:apollo\n' +
        'TF-0002E  title  Rotate ingest credentials\n' +
        'TF-0002E  desc   Vault entries expire this month. project:apollo\n' +
        'TF-0003F  title  Apollo cutover notes\n' +
        'TF-0003F  desc   Notes for the apollo cutover. No tracker link yet.\n' +
        'TF-0004G  title  Shard rebalance\n' +
        'TF-0004G  desc   Uneven shards after the split. project:atlas\n' +
        'TF-0005H  title  Deploy gate flake\n' +
        'TF-0005H  desc   CI gate fails intermittently on retry. project:atlas\n' +
        'TF-0006I  title  Restart schedule for edge workers\n' +
        'TF-0006I  desc   Cold pool needs a warm start before peak hours.\n' +
        'TF-0007J  title  Alert rule audit\n' +
        'TF-0007J  desc   Pager fires when priority>=5 which is far too noisy.\n' +
        'TF-0008K  title  Purge legacy dashboards\n' +
        'TF-0008K  desc   Old panels for project:atlas are still deployed.\n' +
        'TF-0009L  title  Retire ingest shim\n' +
        'TF-0009L  desc   Shim for project:atlas can go after the cutover.\n' +
        'TF-000AT  title  Billing export for the quarter\n' +
        'TF-000AT  desc   Export for project:atlas finished last quarter.\n' +
        'TF-000BU  title  Backfill retention job\n' +
        'TF-000BU  desc   Ran short on the eleventh and never finished.'
    },
    {
      name: 'search-audit.log',
      kind: 'log',
      body:
        'capture window 2026-03-16T09:00:00Z, store frozen, 37 accepted queries\n' +
        'q=|...| is the raw query text between the bars. ntok is the planner token count.\n' +
        '\n' +
        '#1  q=||\n' +
        '      ntok=0  hits=10  TF-000BU TF-0001D TF-0005H TF-0004G TF-0002E TF-0009L TF-0007J TF-0003F TF-0006I TF-0008K\n' +
        '#2  q=|   |\n' +
        '      ntok=0  hits=10  TF-000BU TF-0001D TF-0005H TF-0004G TF-0002E TF-0009L TF-0007J TF-0003F TF-0006I TF-0008K\n' +
        '#3  q=|-|\n' +
        '      ntok=0  hits=10  TF-000BU TF-0001D TF-0005H TF-0004G TF-0002E TF-0009L TF-0007J TF-0003F TF-0006I TF-0008K\n' +
        '#4  q=|status:open|\n' +
        '      ntok=1  hits=6  TF-000BU TF-0004G TF-0002E TF-0009L TF-0007J TF-0003F\n' +
        '#5  q=|status:blocked|\n' +
        '      ntok=1  hits=1  TF-0006I\n' +
        '#6  q=|status:open status:blocked|\n' +
        '      ntok=2  hits=7  TF-000BU TF-0004G TF-0002E TF-0009L TF-0007J TF-0003F TF-0006I\n' +
        '#7  q=|status:in-progress|\n' +
        '      ntok=1  hits=1  TF-0001D\n' +
        '#8  q=|status:IN_PROGRESS|\n' +
        '      ntok=1  hits=1  TF-0001D\n' +
        '#9  q=|status:archived|\n' +
        '      ntok=1  hits=1  TF-000AT\n' +
        '#10 q=|owner:ana|\n' +
        '      ntok=1  hits=4  TF-0001D TF-0002E TF-0009L TF-0006I\n' +
        '#11 q=|owner:@ANA|\n' +
        '      ntok=1  hits=4  TF-0001D TF-0002E TF-0009L TF-0006I\n' +
        '#12 q=|status:open owner:ana|\n' +
        '      ntok=2  hits=2  TF-0002E TF-0009L\n' +
        '#13 q=|status:open owner:ana owner:bo|\n' +
        '      ntok=3  hits=5  TF-000BU TF-0004G TF-0002E TF-0009L TF-0003F\n' +
        '#14 q=|-status:open -status:blocked|\n' +
        '      ntok=2  hits=3  TF-0001D TF-0005H TF-0008K\n' +
        '#15 q=|ingest|\n' +
        '      ntok=1  hits=3  TF-0001D TF-0002E TF-0009L\n' +
        '#16 q=|cutover|\n' +
        '      ntok=1  hits=2  TF-0009L TF-0003F\n' +
        '#17 q=|ingest cutover|\n' +
        '      ntok=2  hits=1  TF-0009L\n' +
        '#18 q=|deploy|\n' +
        '      ntok=1  hits=3  TF-0001D TF-0005H TF-0008K\n' +
        '#19 q=|- deploy|\n' +
        '      ntok=1  hits=3  TF-0001D TF-0005H TF-0008K\n' +
        '#20 q=|-deploy|\n' +
        '      ntok=1  hits=7  TF-000BU TF-0004G TF-0002E TF-0009L TF-0007J TF-0003F TF-0006I\n' +
        '#21 q=|cold start|\n' +
        '      ntok=2  hits=2  TF-0001D TF-0006I\n' +
        '#22 q=|"cold start"|\n' +
        '      ntok=1  hits=1  TF-0001D\n' +
        '#23 q=|-"cold start"|\n' +
        '      ntok=1  hits=9  TF-000BU TF-0005H TF-0004G TF-0002E TF-0009L TF-0007J TF-0003F TF-0006I TF-0008K\n' +
        '#24 q=|tag:Fast-Track|\n' +
        '      ntok=1  hits=1  TF-0001D\n' +
        '#25 q=|tag:"needs triage"|\n' +
        '      ntok=1  hits=1  TF-0004G\n' +
        '#26 q=|priority>40 -tag:infra|\n' +
        '      ntok=2  hits=3  TF-000BU TF-0001D TF-0005H\n' +
        '#27 q=|apollo|\n' +
        '      ntok=1  hits=3  TF-0001D TF-0002E TF-0003F\n' +
        '#28 q=|project:apollo|\n' +
        '      ntok=1  hits=2  TF-0001D TF-0002E\n' +
        '#29 q=|project:atlas|\n' +
        '      ntok=1  hits=4  TF-0005H TF-0004G TF-0009L TF-0008K\n' +
        '#30 q=|priority>=5|\n' +
        '      ntok=1  hits=1  TF-0007J\n' +
        '#31 q=|priority>43|\n' +
        '      ntok=1  hits=4  TF-000BU TF-0001D TF-0005H TF-0004G\n' +
        '#32 q=|priority>44|\n' +
        '      ntok=1  hits=2  TF-000BU TF-0001D\n' +
        '#33 q=|priority<39|\n' +
        '      ntok=1  hits=5  TF-0009L TF-0007J TF-0003F TF-0006I TF-0008K\n' +
        '#34 q=|priority<40|\n' +
        '      ntok=1  hits=6  TF-0002E TF-0009L TF-0007J TF-0003F TF-0006I TF-0008K\n' +
        '#35 q=|due<3d|\n' +
        '      ntok=1  hits=3  TF-0001D TF-0005H TF-0002E\n' +
        '#36 q=|due<7d|\n' +
        '      ntok=1  hits=4  TF-0001D TF-0005H TF-0004G TF-0002E\n' +
        '#37 q=|due>14d|\n' +
        '      ntok=1  hits=1  TF-0006I'
    }
  ],

  probe: {
    question:
      'One query was queued but never ran before the capture ended: ' +
      '`project:atlas status:open status:in-review -tag:infra`. Replayed against the same ' +
      'frozen snapshot the planner would log `ntok=4  hits=1`. Which task id is that single hit?',
    kind: 'input',
    choices: null,
    answer: 'TF-0005H',
    normalize: 'upper-trim',
    whiff:
      'Not that one. Four tokens, and they do not all do the same job: compare #29 against ' +
      '#27 before you assume the first one is a field filter at all, then #6 for what two ' +
      'tokens on one field do, then #14.'
  },

  /* ---- PHASE 2: IMPLEMENTATION ---- */
  task: [
    'Write `parseQuery(q)`. It does no matching — it only cuts a raw query string into the ' +
    'normalised token list the matcher consumes, in source order.',

    'Each token is exactly `{ neg, kind, value }`. `neg` is a boolean. `kind` is one of ' +
    '`"term"`, `"status"`, `"owner"`, `"tag"`, `"priority"`, `"due"`.',

    'For `"term"`, `"status"`, `"owner"` and `"tag"`, `value` is the normalised string: a ' +
    'term carries its raw text unchanged; a status is UPPER_SNAKE; an owner is lowercase with ' +
    'a leading `@` stripped; a tag is lowercase. For `"priority"` and `"due"`, `value` is the ' +
    'object `{ op, n }` where `op` is `"<"` or `">"` and `n` is an integer.',

    'An empty or whitespace-only query returns `[]`. A `field:value` token whose field is not ' +
    'one the grammar knows becomes a `"term"` carrying the whole raw token text.',

    'Tests compare with `assertDeep`, so the shape has to be exact — no extra keys, no ' +
    'stray casing.'
  ],
  exports: ['parseQuery'],
  starter:
    '/* Cut a raw TASKFLOW query into the matcher\'s normalised token list. */\n' +
    'function parseQuery(q) {\n' +
    '  var out = [];\n' +
    '  var raws = splitTokens(q);\n' +
    '  for (var i = 0; i < raws.length; i++) {\n' +
    '    // classify raws[i].text, then normalise its value for that kind\n' +
    '  }\n' +
    '  return out;\n' +
    '}\n' +
    '\n' +
    '/* Raw query -> [{ neg: boolean, text: string }, ...] */\n' +
    'function splitTokens(q) {\n' +
    '  var out = [];\n' +
    '  // walk the string: skip whitespace, take a leading "-", then read one token,\n' +
    '  // letting a quoted run swallow whatever is inside it\n' +
    '  return out;\n' +
    '}\n',

  tests: [
    {
      name: 'an empty or whitespace-only query yields no tokens',
      visible: true,
      src:
        'assertDeep(parseQuery(""), []);\n' +
        'assertDeep(parseQuery("   "), []);\n' +
        'assertDeep(parseQuery("\\t \\n "), []);'
    },
    {
      name: 'bare terms keep source order and raw text',
      visible: true,
      src:
        'assertDeep(parseQuery("Cold start"), [\n' +
        '  { neg: false, kind: "term", value: "Cold" },\n' +
        '  { neg: false, kind: "term", value: "start" }\n' +
        ']);'
    },
    {
      name: 'colon fields normalise per field',
      visible: true,
      src:
        'assertDeep(parseQuery("status:open owner:@Ana tag:Infra"), [\n' +
        '  { neg: false, kind: "status", value: "OPEN" },\n' +
        '  { neg: false, kind: "owner", value: "ana" },\n' +
        '  { neg: false, kind: "tag", value: "infra" }\n' +
        ']);'
    },
    {
      name: 'comparison tokens carry an op and an integer',
      visible: true,
      src:
        'assertDeep(parseQuery("priority>40 priority<90 due<3d due>14d"), [\n' +
        '  { neg: false, kind: "priority", value: { op: ">", n: 40 } },\n' +
        '  { neg: false, kind: "priority", value: { op: "<", n: 90 } },\n' +
        '  { neg: false, kind: "due", value: { op: "<", n: 3 } },\n' +
        '  { neg: false, kind: "due", value: { op: ">", n: 14 } }\n' +
        ']);\n' +
        'assertEqual(typeof parseQuery("due<3d")[0].value.n, "number");'
    },
    {
      name: 'a leading dash negates only its own token',
      visible: true,
      src:
        'assertDeep(parseQuery("-status:done deploy"), [\n' +
        '  { neg: true, kind: "status", value: "DONE" },\n' +
        '  { neg: false, kind: "term", value: "deploy" }\n' +
        ']);'
    },
    {
      name: 'quoted runs are one token, quotes stripped, and negatable',
      visible: false,
      src:
        'assertDeep(parseQuery("\\"cold start\\" -\\"needs triage\\" gate"), [\n' +
        '  { neg: false, kind: "term", value: "cold start" },\n' +
        '  { neg: true, kind: "term", value: "needs triage" },\n' +
        '  { neg: false, kind: "term", value: "gate" }\n' +
        ']);'
    },
    {
      name: 'unknown fields and near-miss operators fall back to literal terms',
      visible: false,
      src:
        'assertDeep(parseQuery("project:atlas priority>=5 -foo:bar"), [\n' +
        '  { neg: false, kind: "term", value: "project:atlas" },\n' +
        '  { neg: false, kind: "term", value: "priority>=5" },\n' +
        '  { neg: true, kind: "term", value: "foo:bar" }\n' +
        ']);'
    },
    {
      name: 'a quoted value inside a field is still that field',
      visible: false,
      src:
        'assertDeep(parseQuery("tag:\\"Needs Triage\\" -owner:\\"@Ana\\""), [\n' +
        '  { neg: false, kind: "tag", value: "needs triage" },\n' +
        '  { neg: true, kind: "owner", value: "ana" }\n' +
        ']);'
    },
    {
      name: 'status separators interchange; other fields keep their hyphens',
      visible: false,
      src:
        'assertDeep(parseQuery("status:in-progress -status:IN_review tag:Fast-Track"), [\n' +
        '  { neg: false, kind: "status", value: "IN_PROGRESS" },\n' +
        '  { neg: true, kind: "status", value: "IN_REVIEW" },\n' +
        '  { neg: false, kind: "tag", value: "fast-track" }\n' +
        ']);'
    },
    {
      name: 'a dash with nothing attached to it is not a token',
      visible: false,
      src:
        'assertDeep(parseQuery("-"), []);\n' +
        'assertDeep(parseQuery("  -   deploy   -tag:infra "), [\n' +
        '  { neg: false, kind: "term", value: "deploy" },\n' +
        '  { neg: true, kind: "tag", value: "infra" }\n' +
        ']);'
    }
  ],

  hints: [
    {
      cost: 30,
      text:
        'The `ntok` column is the tokeniser talking out loud. Find every line where `ntok` ' +
        'disagrees with a plain whitespace split of the query text — #3, #19 and #22 are three ' +
        'different disagreements — and you have the whole cutting rule. Only then worry about ' +
        'what the pieces mean.'
    },
    {
      cost: 30,
      text:
        'Exactly three prefixes are followed by a colon and honoured as filters; two more use a ' +
        'bare `<` or `>` with no colon, and one of those two insists on a trailing unit letter. ' +
        'Anything not in one of those five exact forms is not rejected and not dropped — #28 ' +
        'against #27 shows what happens to it, and #30 against TF-0007J in the text index shows ' +
        'the same thing happening to a malformed operator. For normalisation, put #7/#8 next to ' +
        '#24 and ask why the same character is treated differently in the two values.'
    }
  ],

  /* ---- PHASE 3: REVEAL ---- */
  reveal: {
    reqId: 'REQ-05',
    title: 'Search query grammar',
    body: [
      'searchTasks(store, query, nowISO) tokenises the query, classifies each token, then ' +
      'combines the tokens into one result set.',

      'TOKENISING. Split on whitespace. Inside a token a double-quoted run is taken literally ' +
      'and the quotes are stripped, so a quoted phrase stays one token and may contain spaces ' +
      '(`"cold start"` is one token). A leading `-` negates the token and is consumed before ' +
      'quoting is considered, so `-"cold start"` is a valid negated phrase. A token whose text ' +
      'ends up empty — a lone `-` — is discarded entirely. An empty or whitespace-only query ' +
      'produces no tokens.',

      'TOKEN KINDS, tried in this order against the raw token text. ' +
      '(a) `status:VALUE`, `owner:VALUE`, `tag:VALUE` are the only three colon fields; the ' +
      'field name itself is matched case-insensitively. `status` compares case-insensitively ' +
      'with `-` and `_` interchangeable, so `status:in-progress` == `status:IN_PROGRESS`. ' +
      '`owner` compares case-insensitively with a leading `@` stripped, so `owner:@ana` == ' +
      '`owner:ana`; a task whose owner is null never matches. `tag` is a case-insensitive ' +
      'exact match against one of `task.tags`, with no separator rewriting, so `tag:Fast-Track` ' +
      'matches the tag `fast-track`. ' +
      '(b) `priority>N` / `priority<N` — no colon, N a run of digits — is a strict comparison ' +
      'against the REQ-02 score, so `priority>44` excludes a task scoring exactly 44. ' +
      '(c) `due<Nd` / `due>Nd` — no colon, trailing `d` required. `due<Nd` matches when ' +
      '`dueAt != null` and `0 <= hoursUntil(dueAt, now) < N*24`, so a deadline already in the ' +
      'past never matches. `due>Nd` matches when `dueAt != null` and ' +
      '`hoursUntil(dueAt, now) > N*24`. ' +
      '(d) Anything else is a bare term carrying the whole raw token text — this covers an ' +
      'unknown field such as `project:atlas` and a near-miss operator such as `priority>=5`, ' +
      'both of which are searched as literal text. A bare term is a case-insensitive substring ' +
      'test against `title` OR `description`.',

      'COMBINATION. (1) Positive tokens of different kinds/fields are ANDed. (2) Repeated ' +
      'positive tokens of the same field are ORed with each other: `status:open status:blocked` ' +
      'matches either. Bare terms are the exception — they AND with each other, so ' +
      '`ingest cutover` needs both. (3) A negated token is always ANDed and excludes any task ' +
      'it matches, whatever its field. (4) An empty or whitespace-only query matches every ' +
      'task whose status is not `ARCHIVED`. (5) `ARCHIVED` tasks are excluded from every ' +
      'result unless the query carries a positive `status:archived` token. (6) Results are ' +
      'sorted by the REQ-02 canonical ordering: score DESC, then dueAt ASC with nulls last, ' +
      'then createdAt ASC, then id ASC.'
    ]
  },

  reference:
    'function parseQuery(q) {\n' +
    '  var s = q == null ? "" : String(q);\n' +
    '  var out = [];\n' +
    '  var i = 0;\n' +
    '  while (i < s.length) {\n' +
    '    while (i < s.length && /\\s/.test(s.charAt(i))) i++;\n' +
    '    if (i >= s.length) break;\n' +
    '    var neg = false;\n' +
    '    if (s.charAt(i) === "-") { neg = true; i++; }\n' +
    '    var buf = "";\n' +
    '    while (i < s.length && !/\\s/.test(s.charAt(i))) {\n' +
    '      if (s.charAt(i) === "\\"") {\n' +
    '        i++;\n' +
    '        while (i < s.length && s.charAt(i) !== "\\"") { buf += s.charAt(i); i++; }\n' +
    '        i++;\n' +
    '      } else { buf += s.charAt(i); i++; }\n' +
    '    }\n' +
    '    if (buf !== "") out.push(classifyRaw(neg, buf));\n' +
    '  }\n' +
    '  return out;\n' +
    '}\n' +
    '\n' +
    'function classifyRaw(neg, raw) {\n' +
    '  var m = /^([a-zA-Z]+):(.*)$/.exec(raw);\n' +
    '  if (m) {\n' +
    '    var f = m[1].toLowerCase(), v = m[2];\n' +
    '    if (f === "status") return { neg: neg, kind: "status", value: v.toUpperCase().replace(/-/g, "_") };\n' +
    '    if (f === "owner")  return { neg: neg, kind: "owner",  value: v.toLowerCase().replace(/^@/, "") };\n' +
    '    if (f === "tag")    return { neg: neg, kind: "tag",    value: v.toLowerCase() };\n' +
    '  }\n' +
    '  var p = /^priority([<>])(\\d+)$/.exec(raw);\n' +
    '  if (p) return { neg: neg, kind: "priority", value: { op: p[1], n: parseInt(p[2], 10) } };\n' +
    '  var d = /^due([<>])(\\d+)d$/.exec(raw);\n' +
    '  if (d) return { neg: neg, kind: "due", value: { op: d[1], n: parseInt(d[2], 10) } };\n' +
    '  return { neg: neg, kind: "term", value: raw };\n' +
    '}\n'
});
