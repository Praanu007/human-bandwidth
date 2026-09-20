/* HUMAN BANDWIDTH — code sandbox.
 *
 * Runs player code against a list of tests, isolated from the game, and always terminable.
 *
 * Two execution backends:
 *   1. Web Worker from a blob URL — preferred. Terminable mid-loop, truly off-thread.
 *   2. Sandboxed iframe (srcdoc, allow-scripts) — fallback for file://, where Chrome
 *      refuses to construct a worker from a null-origin blob.
 *
 * Both backends get the same loop guard injected into the player's code, so an infinite
 * loop raises inside the sandbox instead of wedging the tab. The host also runs a
 * watchdog: if the sandbox goes quiet, it is torn down and the remaining tests are
 * reported as timed out rather than lost.
 */
(function (HB) {
  'use strict';

  var PER_TEST_MS = 3000;
  var SLACK_MS = 2500;

  /* ------------------------------------------------------------------ *
   * Loop guard
   *
   * Instruments loop HEADERS only — never bodies — so no newline is ever added and the
   * player's line numbers survive intact. `while (c)` becomes `while (__hbTick() && (c))`,
   * `for (a; b; c)` becomes `for (a; __hbTick() && (b); c)`. for-of / for-in headers have
   * no test clause to hook, so they are left alone and the watchdog covers them.
   * ------------------------------------------------------------------ */

  // Scan `src` from `i`, returning the index just past the matching close of the
  // bracket at `i`. Skips strings, template literals, comments and regex literals.
  function matchBracket(src, i) {
    var open = src[i], close = open === '(' ? ')' : open === '[' ? ']' : '}';
    var depth = 0;
    var n = src.length;
    var tmpl = [];               // template-literal ${} nesting
    while (i < n) {
      var c = src[i];
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '"' || c === "'") { i = skipString(src, i); continue; }
      if (c === '`') { i = skipTemplate(src, i, tmpl); continue; }
      if (c === '/' && regexPosition(src, i)) { i = skipRegex(src, i); continue; }
      if (c === open || (open !== close && (c === '(' || c === '[' || c === '{'))) {
        if (c === open) depth++;
        else { i = matchBracket(src, i); continue; }
      } else if (c === close) {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return -1;
  }

  function skipString(src, i) {
    var q = src[i++];
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === q) return i + 1;
      i++;
    }
    return i;
  }

  function skipTemplate(src, i) {
    i++; // past the opening backtick
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') return i + 1;
      if (src[i] === '$' && src[i + 1] === '{') { i = matchBracket(src, i + 1); if (i < 0) return src.length; continue; }
      i++;
    }
    return i;
  }

  function skipRegex(src, i) {
    i++; // past the opening slash
    var inClass = false;
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '[') inClass = true;
      else if (src[i] === ']') inClass = false;
      else if (src[i] === '/' && !inClass) { i++; while (i < src.length && /[a-z]/i.test(src[i])) i++; return i; }
      else if (src[i] === '\n') return i;
      i++;
    }
    return i;
  }

  var REGEX_KEYWORDS = /(?:^|[^\w$.])(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

  // Is the `/` at index i the start of a regex literal rather than a division operator?
  function regexPosition(src, i) {
    var j = i - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) return true;
    var c = src[j];
    if ('(,=:[!&|?{};+-*%^~<>'.indexOf(c) !== -1) return true;
    if (/[\w$]/.test(c)) {
      var k = j;
      while (k >= 0 && /[\w$]/.test(src[k])) k--;
      return REGEX_KEYWORDS.test(src.slice(0, j + 1));
    }
    return false;
  }

  // Split a classic for-header on its two top-level semicolons.
  function splitForHeader(h) {
    var parts = [], start = 0, depth = 0, i = 0, tmpl = [];
    while (i < h.length && parts.length < 2) {
      var c = h[i];
      if (c === '/' && h[i + 1] === '/') { while (i < h.length && h[i] !== '\n') i++; continue; }
      if (c === '/' && h[i + 1] === '*') { i += 2; while (i < h.length && !(h[i] === '*' && h[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '"' || c === "'") { i = skipString(h, i); continue; }
      if (c === '`') { i = skipTemplate(h, i, tmpl); continue; }
      if (c === '/' && regexPosition(h, i)) { i = skipRegex(h, i); continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ';' && depth === 0) { parts.push(h.slice(start, i)); start = i + 1; }
      i++;
    }
    if (parts.length < 2) return null;          // for-of / for-in
    parts.push(h.slice(start));
    return parts;
  }

  function instrument(src) {
    var out = '', i = 0, n = src.length, tmpl = [];
    while (i < n) {
      var c = src[i];
      if (c === '/' && src[i + 1] === '/') { var e = src.indexOf('\n', i); e = e < 0 ? n : e; out += src.slice(i, e); i = e; continue; }
      if (c === '/' && src[i + 1] === '*') { var e2 = src.indexOf('*/', i + 2); e2 = e2 < 0 ? n : e2 + 2; out += src.slice(i, e2); i = e2; continue; }
      if (c === '"' || c === "'") { var e3 = skipString(src, i); out += src.slice(i, e3); i = e3; continue; }
      if (c === '`') { var e4 = skipTemplate(src, i, tmpl); out += src.slice(i, e4); i = e4; continue; }
      if (c === '/' && regexPosition(src, i)) { var e5 = skipRegex(src, i); out += src.slice(i, e5); i = e5; continue; }

      if ((c === 'w' || c === 'f') && /[\w$]/.test(c)) {
        var isWhile = src.startsWith('while', i);
        var isFor = !isWhile && src.startsWith('for', i);
        var wordLen = isWhile ? 5 : 3;
        var before = i === 0 ? '' : src[i - 1];
        var after = src[i + wordLen];
        if ((isWhile || isFor) && !/[\w$.]/.test(before) && !/[\w$]/.test(after || ' ')) {
          var p = i + wordLen;
          while (p < n && /\s/.test(src[p])) p++;
          if (src[p] === '(') {
            var end = matchBracket(src, p);
            if (end > 0) {
              var header = src.slice(p + 1, end - 1);
              if (isWhile) {
                out += src.slice(i, p + 1) + '__hbTick() && (' + instrument(header) + ')' + ')';
                i = end;
                continue;
              }
              var parts = splitForHeader(header);
              if (parts) {
                var test = parts[1].trim() === '' ? '__hbTick()' : '__hbTick() && (' + instrument(parts[1]) + ')';
                out += src.slice(i, p + 1) + instrument(parts[0]) + ';' + test + ';' + instrument(parts[2]) + ')';
                i = end;
                continue;
              }
            }
          }
        }
      }
      out += c;
      i++;
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * The program that runs inside the sandbox.
   * ------------------------------------------------------------------ */

  function buildProgram(opts) {
    return [
      '(function(){',
      '"use strict";',
      'var PER_TEST_MS = ' + JSON.stringify(opts.perTestMs) + ';',
      'var NAMES = ' + JSON.stringify(opts.exports) + ';',
      'var TESTS = ' + JSON.stringify(opts.tests.map(function (t) {
        return { name: t.name, src: t.src, visible: !!t.visible, area: t.area || null };
      })) + ';',
      'var USER = ' + JSON.stringify(opts.code) + ';',
      '',
      'var __deadline = 0, __ticks = 0;',
      'function __hbTick(){',
      '  if ((++__ticks & 1023) === 0 && Date.now() > __deadline) {',
      '    var e = new Error("EXECUTION TIMEOUT — a loop ran too long"); e.__timeout = true; throw e;',
      '  }',
      '  return true;',
      '}',
      '',
      'function deepEqual(a,b){',
      '  if (a === b) return true;',
      '  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);',
      '  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;',
      '  if (Array.isArray(a) !== Array.isArray(b)) return false;',
      '  var ka = Object.keys(a), kb = Object.keys(b);',
      '  if (ka.length !== kb.length) return false;',
      '  for (var i=0;i<ka.length;i++){ if (kb.indexOf(ka[i]) === -1) return false; if (!deepEqual(a[ka[i]], b[ka[i]])) return false; }',
      '  return true;',
      '}',
      'function show(v){',
      '  if (typeof v === "string") return JSON.stringify(v);',
      '  if (typeof v === "function") return "[function " + (v.name||"anonymous") + "]";',
      '  if (v === undefined) return "undefined";',
      '  try { var s = JSON.stringify(v); return s === undefined ? String(v) : (s.length > 400 ? s.slice(0,400) + "…" : s); }',
      '  catch (e) { return String(v); }',
      '}',
      'function AssertionError(m){ var e = new Error(m); e.__assert = true; return e; }',
      '',
      'function post(m){ ' + opts.postExpr + ' }',
      '',
      '/* compile the player\'s code once; every test shares the resulting scope */',
      'var scope = null, compileError = null;',
      'try {',
      '  var factory = new Function("__hbTick", USER + "\\n;return {" + NAMES.map(function(n){',
      '    return JSON.stringify(n) + ": typeof " + n + " === \\"function\\" ? " + n + " : undefined";',
      '  }).join(",") + "};");',
      '  __deadline = Date.now() + PER_TEST_MS;',
      '  scope = factory(__hbTick);',
      '} catch (e) {',
      '  compileError = (e && e.name === "SyntaxError" ? "SyntaxError: " : "") + (e && e.message || String(e));',
      '}',
      '',
      'if (compileError) { post({ kind: "compile", error: compileError }); return; }',
      '',
      'var missing = NAMES.filter(function(n){ return typeof scope[n] !== "function"; });',
      'if (missing.length) {',
      '  post({ kind: "compile", error: "Your code must define: " + missing.join(", ") });',
      '  return;',
      '}',
      '',
      'post({ kind: "start", total: TESTS.length });',
      '',
      'for (var ti = 0; ti < TESTS.length; ti++) {',
      '  var t = TESTS[ti];',
      '  var logs = [];',
      '  var helpers = {',
      '    assert: function(c,m){ if(!c) throw AssertionError(m || "assert failed"); },',
      '    assertEqual: function(a,b,m){ if(a !== b) throw AssertionError((m?m+": ":"") + "expected " + show(b) + ", got " + show(a)); },',
      '    assertDeep: function(a,b,m){ if(!deepEqual(a,b)) throw AssertionError((m?m+": ":"") + "expected " + show(b) + ", got " + show(a)); },',
      '    assertClose: function(a,b,eps,m){ eps = eps == null ? 1e-9 : eps; if(!(Math.abs(a-b) <= eps)) throw AssertionError((m?m+": ":"") + "expected ~" + show(b) + ", got " + show(a)); },',
      '    assertThrows: function(fn,msg){',
      '      var threw = false, got = null;',
      '      try { fn(); } catch (e) { if (e && e.__timeout) throw e; threw = true; got = e && e.message; }',
      '      if (!threw) throw AssertionError("expected a throw" + (msg ? " of " + show(msg) : "") + ", but nothing was thrown");',
      '      if (msg != null && got !== msg) throw AssertionError("expected throw " + show(msg) + ", got " + show(got));',
      '    },',
      '    log: function(){ logs.push(Array.prototype.map.call(arguments, show).join(" ")); }',
      '  };',
      '  var argNames = NAMES.concat(Object.keys(helpers));',
      '  var argVals = NAMES.map(function(n){ return scope[n]; }).concat(Object.keys(helpers).map(function(k){ return helpers[k]; }));',
      '  var started = Date.now();',
      '  __deadline = started + PER_TEST_MS;',
      '  __ticks = 0;',
      '  try {',
      '    (new Function(argNames.join(","), t.src)).apply(null, argVals);',
      '    post({ kind: "test", index: ti, name: t.name, visible: t.visible, area: t.area, ok: true, ms: Date.now()-started, logs: logs });',
      '  } catch (e) {',
      '    post({ kind: "test", index: ti, name: t.name, visible: t.visible, area: t.area, ok: false,',
      '           ms: Date.now()-started, logs: logs,',
      '           err: (e && e.__assert) ? e.message : ((e && e.name ? e.name + ": " : "") + (e && e.message || String(e))) });',
      '  }',
      '}',
      'post({ kind: "done" });',
      '})();'
    ].join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Backends
   * ------------------------------------------------------------------ */

  var workerUsable = null;   // null = untried, true/false once known

  function runInWorker(program, onMessage, onDead) {
    var url = URL.createObjectURL(new Blob([program], { type: 'text/javascript' }));
    var w = new Worker(url);
    w.onmessage = function (e) { onMessage(e.data); };
    w.onerror = function (e) { onDead(e && e.message ? e.message : 'worker error'); };
    return {
      kill: function () {
        try { w.terminate(); } catch (e) { /* already gone */ }
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      }
    };
  }

  function runInFrame(program, nonce, onMessage) {
    var frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none';
    var doc = '<!doctype html><meta charset="utf-8"><script>\n' +
      'var __NONCE=' + JSON.stringify(nonce) + ';\n' +
      program.replace(/<\/script/gi, '<\\/script') +
      '\n<\/script>';
    frame.srcdoc = doc;

    function listener(e) {
      var d = e.data;
      if (!d || d.__nonce !== nonce) return;
      onMessage(d.payload);
    }
    window.addEventListener('message', listener);
    document.body.appendChild(frame);

    return {
      kill: function () {
        window.removeEventListener('message', listener);
        if (frame.parentNode) frame.parentNode.removeChild(frame);
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  /**
   * run({ code, exports, tests, perTestMs, onProgress }) -> Promise<result>
   *
   * result = {
   *   compileError: string|null,
   *   results: [{ name, visible, area, ok, err, ms, logs, timedOut }]
   * }
   * Every declared test always appears in `results`, even if the sandbox died first.
   */
  function run(opts) {
    var tests = opts.tests || [];
    var perTestMs = opts.perTestMs || PER_TEST_MS;
    var nonce = 'hb' + Math.random().toString(36).slice(2) + Date.now().toString(36);

    var useWorker = workerUsable !== false && typeof Worker === 'function' && typeof Blob === 'function' && typeof URL !== 'undefined' && URL.createObjectURL;

    var postExpr = useWorker
      ? 'self.postMessage(m);'
      : 'parent.postMessage({ __nonce: __NONCE, payload: m }, "*");';

    var program = buildProgram({
      code: instrument(opts.code || ''),
      exports: opts.exports || [],
      tests: tests,
      perTestMs: perTestMs,
      postExpr: postExpr
    });

    return new Promise(function (resolve) {
      var byIndex = new Array(tests.length);
      var compileError = null;
      var settled = false;
      var handle = null;
      var watchdog = null;

      function finish(reason) {
        if (settled) return;
        settled = true;
        if (watchdog) clearTimeout(watchdog);
        if (handle) handle.kill();
        var results = tests.map(function (t, i) {
          if (byIndex[i]) return byIndex[i];
          return {
            name: t.name, visible: !!t.visible, area: t.area || null, ok: false,
            err: reason || 'did not run', ms: 0, logs: [], timedOut: true
          };
        });
        resolve({ compileError: compileError, results: results });
      }

      function arm() {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(function () {
          finish('EXECUTION TIMEOUT — the sandbox stopped responding');
        }, perTestMs + SLACK_MS);
      }

      function onMessage(m) {
        if (!m || settled) return;
        arm();
        if (m.kind === 'compile') { compileError = m.error; finish(null); return; }
        if (m.kind === 'test') {
          byIndex[m.index] = {
            name: m.name, visible: m.visible, area: m.area, ok: m.ok,
            err: m.err || null, ms: m.ms, logs: m.logs || [], timedOut: false
          };
          if (opts.onProgress) {
            try { opts.onProgress(byIndex[m.index], m.index, tests.length); } catch (e) { /* UI only */ }
          }
          return;
        }
        if (m.kind === 'done') finish(null);
      }

      try {
        if (useWorker) {
          handle = runInWorker(program, onMessage, function (msg) {
            // A worker that dies on construction means this origin forbids blob workers.
            if (workerUsable === null && !byIndex.some(Boolean) && compileError === null) {
              workerUsable = false;
              if (handle) handle.kill();
              settled = true;
              if (watchdog) clearTimeout(watchdog);
              // Retry once through the iframe backend.
              run(opts).then(resolve);
              return;
            }
            finish(msg);
          });
          workerUsable = true;
        } else {
          handle = runInFrame(program, nonce, onMessage);
        }
      } catch (e) {
        if (useWorker) { workerUsable = false; run(opts).then(resolve); return; }
        compileError = 'sandbox failed to start: ' + (e && e.message);
        finish(null);
        return;
      }
      arm();
    });
  }

  HB.Sandbox = { run: run, instrument: instrument };
})(window.HB = window.HB || {});
