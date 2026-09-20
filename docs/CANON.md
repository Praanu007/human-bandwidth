# TASKFLOW CANON — the single source of truth

Every signal, every bonus, and the final evaluator MUST agree with this file.
This file contains the **answers**. Players never see it.

A signal's job is to build a puzzle whose *only correct conclusion* is the rule below.
The final build's job is to test that the player applies the rule.

All times are ISO-8601 UTC strings (`2026-03-14T09:00:00Z`). Nothing calls `Date.now()`.
Every time-dependent function takes an explicit `nowISO` argument. Tests are deterministic.

---

## REQ-01 — Task identifier format

A store keeps a monotonic counter `seq`, starting at **1**, incremented on every successful
`createTask` (deleted tasks do NOT free their number).

```
core     = seq.toString(36).toUpperCase().padStart(4, '0')
checksum = (sum of char codes of the 4 core chars) % 36, .toString(36).toUpperCase()
id       = 'TF-' + core + checksum
```

Worked examples (canonical — use these verbatim):

| seq  | core   | code sum | %36 | checksum | id         |
|------|--------|----------|-----|----------|------------|
| 1    | `0001` | 193      | 13  | `D`      | `TF-0001D` |
| 2    | `0002` | 194      | 14  | `E`      | `TF-0002E` |
| 35   | `000Z` | 234      | 18  | `I`      | `TF-000ZI` |
| 36   | `0010` | 193      | 13  | `D`      | `TF-0010D` |
| 375  | `00AF` | 231      | 15  | `F`      | `TF-00AFF` |
| 1295 | `00ZZ` | 276      | 24  | `O`      | `TF-00ZZO` |
| 1296 | `0100` | 193      | 13  | `D`      | `TF-0100D` |

`decodeTaskId(id)` returns the integer `seq`.
It throws `Error('BAD_ID')` when: the prefix is not `TF-`, the length is not 8,
a core char is not `[0-9A-Z]`, or the checksum char does not match.
Lowercase input is invalid (throws) — IDs are canonical uppercase.

---

## REQ-02 — Priority score

Task fields used: `urgency` (int 0-5), `impact` (int 0-5), `blocking` (int >= 0),
`createdAt`, `dueAt` (nullable), `status`.

```
base     = 5*urgency + 3*impact + 2*Math.min(blocking, 5)
ageDays  = Math.floor(hoursBetween(createdAt, now) / 24)
ageBonus = Math.min(Math.max(ageDays, 0), 10)

h = hoursUntil(dueAt, now)            // null dueAt -> dueFactor 0
dueFactor = dueAt == null ? 0
          : h <= 0   ? 25
          : h <= 24  ? 15
          : h <= 72  ? 8
          : h <= 168 ? 3
          : 0

raw = base + ageBonus + dueFactor
if (status === 'BLOCKED') raw = raw * 0.5
if (status === 'DONE' || status === 'CANCELLED' || status === 'ARCHIVED') return 0
score = Math.min(100, Math.floor(raw))
```

`urgency`/`impact` are clamped into 0..5 on write; `blocking` is clamped to >= 0.

**Canonical ordering** (used by search, filter, and any sorted output):
`score` DESC, then `dueAt` ASC with **nulls last**, then `createdAt` ASC, then `id` ASC (string compare).

---

## REQ-03 — Status state machine

Statuses: `DRAFT OPEN IN_PROGRESS BLOCKED IN_REVIEW DONE CANCELLED ARCHIVED`.

```
DRAFT       -> OPEN, CANCELLED
OPEN        -> IN_PROGRESS, BLOCKED, CANCELLED
IN_PROGRESS -> BLOCKED, IN_REVIEW, OPEN, CANCELLED
BLOCKED     -> IN_PROGRESS, OPEN, CANCELLED
IN_REVIEW   -> DONE, IN_PROGRESS, BLOCKED
DONE        -> ARCHIVED, IN_PROGRESS
CANCELLED   -> ARCHIVED
ARCHIVED    -> (terminal)
```

Rules:
1. An illegal transition throws `Error('ILLEGAL_TRANSITION')`.
2. A transition to the **same** status is a silent no-op: returns the task unchanged,
   appends nothing to history, does NOT throw. (Even `ARCHIVED -> ARCHIVED`.)
3. Every accepted transition appends `{ from, to, at }` to `task.history`.
4. Entering `DONE` sets `task.completedAt = at`. Leaving `DONE` (reopen) sets it back to `null`.
5. **Fast-track rule:** `IN_PROGRESS -> DONE` is NOT in the table. `completeTask` may only
   shortcut straight from `IN_PROGRESS` to `DONE` when the task's `tags` include
   `'fast-track'`. Otherwise `completeTask` on an `IN_PROGRESS` task throws
   `Error('REVIEW_REQUIRED')`.
6. `completeTask` on a task already `DONE` is a no-op (rule 2). On `DRAFT`, `BLOCKED`,
   `CANCELLED` or `ARCHIVED` it throws `Error('ILLEGAL_TRANSITION')`.
7. An unknown status string throws `Error('UNKNOWN_STATUS')`.

---

## REQ-04 — Deadlines, business days, overdue

Business day = Mon-Fri (UTC) that is not a holiday.

```
TASKFLOW_HOLIDAYS = ['2026-01-01', '2026-07-04', '2026-11-26', '2026-12-25']
```

1. **Deadline rollover.** When a deadline is set (`createTask` or `setDeadline`) and its UTC
   calendar date is a weekend or a holiday, it rolls **forward** to `17:00:00Z` on the next
   business day. A deadline already on a business day keeps its exact time.
   Rollover repeats until a business day is reached (e.g. Sat -> Sun -> Mon).
2. **Grace period.** A task is overdue when `now > dueAt + 4 hours` AND its status is not
   `DONE`, `CANCELLED` or `ARCHIVED`. Exactly at `dueAt + 4h` it is NOT yet overdue.
3. A task with `dueAt === null` is never overdue.
4. `overdueTasks(store, now)` returns overdue tasks sorted by overdue-duration DESC
   (oldest deadline first), then `id` ASC.
5. `businessDaysBetween(aISO, bISO)` counts business days strictly after `a`'s date up to
   and including `b`'s date; negative when `b < a`; `0` when same date.

---

## REQ-05 — Search grammar

`searchTasks(store, query, nowISO)`.

Tokenising: split on whitespace; `"double quoted"` runs stay one token (quotes stripped).
A leading `-` on a token negates it (before the quote is parsed: `-"foo bar"` is valid).

Token kinds:
- bare term -> case-insensitive substring of `title` OR `description`
- `status:VALUE` -> case-insensitive; `-` and `_` are interchangeable (`in-progress` == `IN_PROGRESS`)
- `owner:VALUE` -> case-insensitive, a leading `@` is stripped (`owner:@ana` == `owner:ana`)
- `tag:VALUE` -> case-insensitive exact match against one of `task.tags`
- `priority>N` / `priority<N` -> strict comparison against REQ-02 score
- `due<Nd` -> `dueAt != null` AND `0 <= hoursUntil(dueAt) < N*24`
- `due>Nd` -> `dueAt != null` AND `hoursUntil(dueAt) > N*24`

Combination:
1. Tokens of **different** kinds/fields are ANDed.
2. Repeated **positive** tokens of the same field are ORed with each other
   (`status:open status:blocked` -> either). Bare terms are ANDed with each other.
3. A negated token excludes any task matching it, and is always ANDed.
4. An empty or whitespace-only query matches every task whose status is not `ARCHIVED`.
5. `ARCHIVED` tasks are excluded unless the query explicitly asks `status:archived`.
6. An unparseable `field:` token (unknown field) is treated as a **bare term**
   (so `foo:bar` searches for the literal text `foo:bar`).
7. Results are sorted by the REQ-02 canonical ordering.

---

## REQ-06 — Workload and deadline notifications

```
taskLoad(task, now):
  if status in {DONE, CANCELLED, ARCHIVED} -> 0
  base = priorityScore(task, now) / 10
  if status === 'IN_PROGRESS' -> base = base * 1.5
  if status === 'BLOCKED'     -> base = base * 0.25
  if task is overdue (REQ-04) -> base = base + 2      // added AFTER the multiplier
  return base

userWorkload(store, owner, now):
  sum taskLoad over the owner's tasks (owner compared case-insensitively, '@' stripped)
  cap the sum at 40
  return Math.round(sum * 100) / 100
```

`deadlineNotifications(store, now)` -> array of `{ taskId, owner, kind, dueAt }`,
sorted by `dueAt` ASC then `taskId` ASC.

Bands (non-overlapping; `h = hoursUntil(dueAt, now)`):
```
h <= 0 and past the 4h grace  -> 'OVERDUE'
0 < h <= 24                   -> 'T_MINUS_24H'
24 < h <= 72                  -> 'T_MINUS_72H'
72 < h <= 168                 -> 'T_MINUS_7D'
otherwise                     -> no notification
```
No notification for `dueAt === null` or status in {DONE, CANCELLED, ARCHIVED}.
A task inside the grace window (`0 >= h > -4h`) emits **no** notification at all.

**Suppression rule:** if an owner's `userWorkload` is `>= 30`, that owner only receives
`OVERDUE` and `T_MINUS_24H` notifications. The quieter bands are dropped for them.

---

## TASKFLOW public API (the final build)

Player code must define these as top-level functions.

```js
createStore()                                  -> store
createTask(store, input)                       -> task        // input below
getTask(store, id)                             -> task | null
updateTask(store, id, patch)                   -> task        // throws NOT_FOUND
deleteTask(store, id)                          -> boolean     // false if absent
transition(store, id, nextStatus, atISO)       -> task
completeTask(store, id, atISO)                 -> task
setDeadline(store, id, dueAtISO_or_null)       -> task
priorityScore(task, nowISO)                    -> number
searchTasks(store, query, nowISO)              -> task[]
filterTasks(store, criteria, nowISO)           -> task[]
userWorkload(store, owner, nowISO)             -> number
overdueTasks(store, nowISO)                    -> task[]
deadlineNotifications(store, nowISO)           -> object[]
businessDaysBetween(aISO, bISO)                -> number
```

`createTask` input: `{ title, description?, owner?, urgency?, impact?, blocking?,
dueAt?, tags?, createdAt }` — `createdAt` is always supplied by tests.
Defaults: `description: ''`, `owner: null`, `urgency: 0`, `impact: 0`, `blocking: 0`,
`dueAt: null`, `tags: []`, `status: 'DRAFT'`, `completedAt: null`, `history: []`.
A missing or blank `title` throws `Error('TITLE_REQUIRED')`.

`updateTask` patch may touch `title description owner urgency impact blocking tags`.
It may NOT change `status` (throws `Error('USE_TRANSITION')`) or `id` (silently ignored).
Patching `dueAt` goes through the REQ-04 rollover, same as `setDeadline`.

`filterTasks` criteria: `{ status?, statuses?, owner?, tag?, tags?, overdue?,
minPriority?, maxPriority?, dueBefore?, dueAfter? }` — all optional, all ANDed.
`tags` matches tasks having **all** listed tags. Excludes `ARCHIVED` unless
`status`/`statuses` names it. Sorted by the REQ-02 canonical ordering.

`getTask` returns the live stored object. Everything that returns a list returns a new array.

---

## Error contract

Thrown errors use these exact messages: `BAD_ID`, `NOT_FOUND`, `TITLE_REQUIRED`,
`ILLEGAL_TRANSITION`, `REVIEW_REQUIRED`, `UNKNOWN_STATUS`, `USE_TRANSITION`.
