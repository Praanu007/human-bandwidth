#!/usr/bin/env node
/* Content self-check.
 *
 *   node tools/checkcontent.js content/signals/s01.js
 *   node tools/checkcontent.js            # every registered content file
 *
 * Loads a content module, then runs every declared test against that module's own
 * `reference` solution in the same sandbox the game uses. A content file only ships
 * when this exits 0. Also validates the shape rules in docs/CONTENT-CONTRACT.md.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var AREAS = ['creation', 'deletion', 'completion', 'editing', 'deadlines', 'priority',
  'transitions', 'search', 'filtering', 'workload', 'overdue', 'notifications'];

/* ---------- the sandbox the game uses ---------- */

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(function (k) { return kb.indexOf(k) !== -1 && deepEqual(a[k], b[k]); });
}

function show(v) {
  try { return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) || String(v); }
  catch (e) { return String(v); }
}

function makeHelpers(logs) {
  function fail(msg) { var e = new Error(msg); e.__assert = true; throw e; }
  return {
    assert: function (c, m) { if (!c) fail(m || 'assert failed'); },
    assertEqual: function (a, b, m) {
      if (a !== b) fail((m ? m + ': ' : '') + 'expected ' + show(b) + ', got ' + show(a));
    },
    assertDeep: function (a, b, m) {
      if (!deepEqual(a, b)) fail((m ? m + ': ' : '') + 'expected ' + show(b) + ', got ' + show(a));
    },
    assertClose: function (a, b, eps, m) {
      eps = eps == null ? 1e-9 : eps;
      if (!(Math.abs(a - b) <= eps)) fail((m ? m + ': ' : '') + 'expected ~' + show(b) + ', got ' + show(a));
    },
    assertThrows: function (fn, msg) {
      var threw = false, got = null;
      try { fn(); } catch (e) { threw = true; got = e && e.message; }
      if (!threw) fail('expected a throw' + (msg ? ' of ' + show(msg) : '') + ', got none');
      if (msg != null && got !== msg) fail('expected throw ' + show(msg) + ', got ' + show(got));
    },
    log: function () { logs.push(Array.prototype.slice.call(arguments).map(show).join(' ')); }
  };
}

function runTests(item, solutionSrc) {
  var names = item.exports || [];
  var scope;
  try {
    scope = vm.runInNewContext(
      '(function(){ "use strict";\n' + solutionSrc + '\nreturn {' +
      names.map(function (n) { return n + ': typeof ' + n + '==="function"?' + n + ':undefined'; }).join(',') +
      '}; })()',
      { console: console }, { timeout: 5000 }
    );
  } catch (e) {
    return [{ name: '<load reference>', ok: false, err: e.message }];
  }
  var missing = names.filter(function (n) { return typeof scope[n] !== 'function'; });
  if (missing.length) {
    return [{ name: '<load reference>', ok: false, err: 'reference does not define: ' + missing.join(', ') }];
  }

  return (item.tests || []).map(function (t) {
    var logs = [];
    var helpers = makeHelpers(logs);
    var argNames = names.concat(Object.keys(helpers));
    var argVals = names.map(function (n) { return scope[n]; }).concat(Object.keys(helpers).map(function (k) { return helpers[k]; }));
    try {
      var fn = vm.runInNewContext(
        '(function(' + argNames.join(',') + '){ "use strict";\n' + t.src + '\n})',
        { console: console }, { timeout: 5000 }
      );
      fn.apply(null, argVals);
      return { name: t.name, ok: true, visible: t.visible, logs: logs };
    } catch (e) {
      return { name: t.name, ok: false, visible: t.visible, err: e.message, logs: logs };
    }
  });
}

/* ---------- shape validation ---------- */

function validateShape(item) {
  var problems = [];
  var need = ['id', 'codename', 'points', 'tests', 'exports', 'starter', 'reference'];
  need.forEach(function (k) { if (item[k] == null) problems.push('missing field: ' + k); });

  if (!Array.isArray(item.tests) || item.tests.length === 0) { problems.push('no tests'); return problems; }
  item.tests.forEach(function (t, i) {
    if (!t.name) problems.push('test[' + i + '] has no name');
    if (typeof t.src !== 'string' || !t.src.trim()) problems.push('test[' + i + '] has no src');
    if (typeof t.visible !== 'boolean') problems.push('test[' + i + '] visible must be boolean');
    if (/\breturn\b/.test(t.src || '') && !/function|=>/.test(t.src || '')) {
      problems.push('test[' + i + '] uses a bare return; src is a statement list');
    }
  });

  var vis = item.tests.filter(function (t) { return t.visible; }).length;
  var hid = item.tests.length - vis;

  if (item.kind === 'build') {
    if (vis !== 12) problems.push('final build needs exactly 12 visible tests, has ' + vis);
    if (hid !== 20) problems.push('final build needs exactly 20 hidden tests, has ' + hid);
    var seen = {};
    item.tests.forEach(function (t, i) {
      if (!t.area) problems.push('build test[' + i + '] has no area');
      else if (AREAS.indexOf(t.area) === -1) problems.push('build test[' + i + '] bad area: ' + t.area);
      else seen[t.area] = true;
    });
    AREAS.forEach(function (a) { if (!seen[a]) problems.push('no test covers area: ' + a); });
  } else {
    if (item.tests.length < 6) problems.push('needs at least 6 tests, has ' + item.tests.length);
    if (vis < 3) problems.push('needs at least 3 visible tests, has ' + vis);
    if (hid < 3) problems.push('needs at least 3 hidden tests, has ' + hid);
  }

  if (item.kind === 'signal') {
    if (!item.probe || !item.probe.question || item.probe.answer == null) problems.push('signal needs a probe');
    if (!item.reveal || !item.reveal.reqId || !Array.isArray(item.reveal.body)) problems.push('signal needs a reveal');
    if (!Array.isArray(item.briefing) || !item.briefing.length) problems.push('signal needs a briefing');
    if (!Array.isArray(item.artifacts) || !item.artifacts.length) problems.push('signal needs artifacts');
    if (!Array.isArray(item.hints) || item.hints.length < 2) problems.push('signal needs >= 2 hints');
  }

  // The starter must NOT already be a solution.
  if (item.starter && item.reference && item.starter.replace(/\s/g, '') === item.reference.replace(/\s/g, '')) {
    problems.push('starter is identical to the reference solution');
  }
  return problems;
}

/* ---------- driver ---------- */

function load(file) {
  var items = [];
  var HB = {
    registerSignal: function (s) { s.kind = 'signal'; items.push(s); },
    registerBonus: function (b) { b.kind = 'bonus'; items.push(b); },
    registerBuild: function (b) { b.kind = 'build'; b.codename = b.codename || 'TASKFLOW'; b.id = b.id || 'FINAL-BUILD'; b.points = b.points || 0; items.push(b); }
  };
  var src = fs.readFileSync(file, 'utf8');
  vm.runInNewContext(src, { HB: HB, console: console }, { filename: file });
  return items;
}

function main() {
  var args = process.argv.slice(2);
  var files = args.length ? args : []
    .concat(globDir('content/signals'))
    .concat(globDir('content/bonus'))
    .concat(globDir('content/taskflow').filter(function (f) { return /build|tests/.test(f); }));

  if (!files.length) { console.log('no content files found'); process.exit(0); }

  var failed = 0, totalTests = 0, totalPass = 0;

  files.forEach(function (file) {
    var abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
    var rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    var items;
    try { items = load(abs); }
    catch (e) { console.log('FAIL  ' + rel + '  — could not load: ' + e.message); failed++; return; }

    items.forEach(function (item) {
      var problems = validateShape(item);
      var results = problems.some(function (p) { return /no tests|missing field: (tests|exports|reference)/.test(p); })
        ? [] : runTests(item, item.reference);
      var bad = results.filter(function (r) { return !r.ok; });
      totalTests += results.length;
      totalPass += results.length - bad.length;

      var head = (problems.length || bad.length) ? 'FAIL' : 'ok  ';
      console.log(head + '  ' + rel + '  [' + item.id + ' ' + item.codename + ']  ' +
        (results.length - bad.length) + '/' + results.length + ' tests pass');
      problems.forEach(function (p) { console.log('        shape: ' + p); });
      bad.forEach(function (r) { console.log('        test "' + r.name + '": ' + r.err); });
      if (problems.length || bad.length) failed++;
    });
  });

  console.log('\n' + (failed ? failed + ' item(s) FAILED' : 'all content ok') +
    '  —  ' + totalPass + '/' + totalTests + ' tests pass');
  process.exit(failed ? 1 : 0);
}

function globDir(rel) {
  var dir = path.join(ROOT, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function (f) { return f.endsWith('.js'); })
    .map(function (f) { return path.join(rel, f); });
}

main();
