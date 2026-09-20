# Content module contract

Every challenge file is a **classic script** (no `import`/`export`, no modules — the game
must run from `file://`). It registers itself on the global `HB` namespace.

```js
/* content/signals/s01.js */
HB.registerSignal({ /* ... */ });
```

## Signal shape

```js
HB.registerSignal({
  id: 'SIGNAL-01',
  index: 1,
  codename: 'HANDSHAKE',        // one word, uppercase
  points: 100,
  estMinutes: 10,
  tagline: 'Six words or fewer.',

  // ---- PHASE 1: INVESTIGATION ----
  briefing: [
    'Paragraph of in-world narrative.',
    'Another paragraph. Plain text; `backticks` render as inline code.'
  ],
  artifacts: [
    { name: 'ingest.log', kind: 'log', body: 'raw text ...' },
    { name: 'observed.tsv', kind: 'table', body: 'seq\tid\n1\tTF-0001D' }
  ],
  // The gate. Player must answer before the editor unlocks. No points; costs time.
  probe: {
    question: 'What is the identifier minted for seq 375?',
    kind: 'input',                   // 'input' | 'choice'
    choices: null,                   // required when kind === 'choice'
    answer: 'TF-00AFF',              // compared after normalisation
    normalize: 'upper-trim',         // 'upper-trim' | 'trim' | 'exact' | 'number'
    whiff: 'Not quite. Re-read the checksum column.'
  },

  // ---- PHASE 2: IMPLEMENTATION ----
  task: [ 'What the player must write, in prose.' ],
  exports: ['decodeTaskId'],         // top-level function names the player must define
  starter: 'function decodeTaskId(id) {\n  \n}\n',
  tests: [
    { name: 'decodes a mid-range id', visible: true,  src: 'assertEqual(decodeTaskId("TF-00AFF"), 375);' },
    { name: 'rejects a bad checksum', visible: false, src: 'assertThrows(() => decodeTaskId("TF-0001X"), "BAD_ID");' }
  ],

  hints: [
    { cost: 30, text: 'First nudge — never the answer.' },
    { cost: 30, text: 'Second nudge — closer.' }
  ],

  // ---- PHASE 3: REVEAL ----
  reveal: {
    reqId: 'REQ-01',
    title: 'Task identifier format',
    body: [ 'The spec fragment the player recovers. This text is added to the',
            'RECONSTRUCTED SPEC panel and is visible for the rest of the run.' ]
  },

  reference: 'function decodeTaskId(id) { ... }'   // must pass every test above
});
```

### Rules for signals

- **6 to 10 tests**, at least 3 visible and at least 3 hidden. Hidden tests carry the edge cases.
- Tests run in a sandbox where the player's `exports` are in scope alongside the assertion
  helpers below. `src` is a string of JS statements — no `return`, no wrapping function.
- Every expected value must be produced by running `tools/reference.js`, never by hand.
- The `probe` answer must be *derivable* from the artifacts alone. No guessing, no outside
  knowledge. Exactly one defensible answer.
- `reveal.body` must state the rule precisely enough that the player can implement the
  final build from it — it is the only place they ever see this rule written down.
- The signal's coding problem must be about *deriving/validating* the rule. Do **not** make
  it identical to a final-build API function; the final build is where they apply it.
- Difficulty must fill `estMinutes` for a strong programmer. No one-liners.

### Assertion helpers available inside `src`

```
assert(cond, msg)              assertEqual(actual, expected, msg)     // strict ===
assertDeep(actual, expected)   assertClose(actual, expected, eps)     // default eps 1e-9
assertThrows(fn, message)      // message optional; matches err.message exactly when given
log(...args)                   // surfaces in the player's output pane
```

## Bonus shape

`HB.registerBonus({ ... })` — same fields as a signal, plus:

```js
{
  id: 'BONUS-01', codename: 'OVERCLOCK', points: 150,
  tier: 'bonus',
  reveal: null,                 // bonuses reveal no requirement
  constraints: [ 'n <= 200000', 'must run under 2s' ],   // shown to the player
  perf: { maxMs: 2000, generator: 'function(){ return [...] }' }  // optional stress test
}
```

BONUS-02 is two-part: it also carries

```js
exploit: {
  question: 'Give the exact input that makes the shipped expander emit a duplicate.',
  kind: 'input', answer: '...', normalize: 'trim',
  points: 80                    // of the 200; the remaining 120 is the patch
}
```

## Final build shape

`HB.registerBuild({ exports, starter, tests, reference })` — 12 `visible: true` tests and
20 `visible: false` tests, every test tagged with `area` from:

```
creation deletion completion editing deadlines priority transitions
search filtering workload overdue notifications
```

Hidden tests must be the ones that check REQ-01..REQ-06 subtleties — a player who skipped
the signals should pass most visible tests and fail most hidden ones.
