/* HUMAN BANDWIDTH — code editor.
 *
 * A textarea with a line-number gutter, indent handling and the shortcuts a
 * programmer reaches for without thinking. No CodeMirror: the event has to run
 * offline, and a 40KB dependency is not worth the syntax colouring.
 */
(function (HB) {
  'use strict';

  var INDENT = '  ';

  function create(host, opts) {
    opts = opts || {};

    var shell = document.createElement('div');
    shell.className = 'editor-shell';

    var gutter = document.createElement('div');
    gutter.className = 'gutter';

    var ta = document.createElement('textarea');
    ta.className = 'code';
    ta.spellcheck = false;
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('aria-label', opts.label || 'Solution code');
    ta.value = opts.value || '';

    shell.appendChild(gutter);
    shell.appendChild(ta);
    host.appendChild(shell);

    function renderGutter() {
      var n = ta.value.split('\n').length;
      var s = '';
      for (var i = 1; i <= n; i++) s += i + '\n';
      gutter.textContent = s;
      gutter.scrollTop = ta.scrollTop;
    }

    function setSel(a, b) { ta.selectionStart = a; ta.selectionEnd = b == null ? a : b; }

    function lineStart(pos) {
      var i = ta.value.lastIndexOf('\n', pos - 1);
      return i + 1;
    }

    function indentBlock(dedent) {
      var v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
      var from = lineStart(a);
      var to = v.indexOf('\n', b);
      if (to === -1) to = v.length;
      var block = v.slice(from, to);
      var changed;
      if (dedent) {
        changed = block.replace(/^[ \t]{1,2}/gm, '');
      } else {
        changed = block.replace(/^/gm, INDENT);
      }
      ta.value = v.slice(0, from) + changed + v.slice(to);
      setSel(from, from + changed.length);
      fire();
    }

    ta.addEventListener('keydown', function (e) {
      var v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;

      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (opts.onRun) opts.onRun();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        fire();
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        if (a !== b || e.shiftKey) { indentBlock(e.shiftKey); return; }
        ta.value = v.slice(0, a) + INDENT + v.slice(b);
        setSel(a + INDENT.length);
        fire();
        return;
      }

      if (e.key === 'Enter') {
        // Keep the current indent, and open a block when the line ends in a brace.
        var ls = lineStart(a);
        var line = v.slice(ls, a);
        var indent = (line.match(/^[ \t]*/) || [''])[0];
        var opensBlock = /[{[(]\s*$/.test(line);
        var closesNext = /^\s*[}\])]/.test(v.slice(b));
        e.preventDefault();
        var insert;
        if (opensBlock && closesNext) {
          insert = '\n' + indent + INDENT + '\n' + indent;
          ta.value = v.slice(0, a) + insert + v.slice(b);
          setSel(a + 1 + indent.length + INDENT.length);
        } else {
          insert = '\n' + indent + (opensBlock ? INDENT : '');
          ta.value = v.slice(0, a) + insert + v.slice(b);
          setSel(a + insert.length);
        }
        fire();
        return;
      }

      // Typing a closing brace on a blank line snaps it back one level.
      if (e.key === '}' || e.key === ')' || e.key === ']') {
        var ls2 = lineStart(a);
        var cur = v.slice(ls2, a);
        if (/^[ \t]+$/.test(cur) && cur.length >= INDENT.length) {
          e.preventDefault();
          var trimmed = cur.slice(0, cur.length - INDENT.length);
          ta.value = v.slice(0, ls2) + trimmed + e.key + v.slice(b);
          setSel(ls2 + trimmed.length + 1);
          fire();
        }
        return;
      }

      // Wrap a selection in brackets or quotes instead of replacing it.
      var pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
      if (a !== b && pairs[e.key]) {
        e.preventDefault();
        ta.value = v.slice(0, a) + e.key + v.slice(a, b) + pairs[e.key] + v.slice(b);
        setSel(a + 1, b + 1);
        fire();
      }
    });

    var saveTimer = null;
    function fire() {
      renderGutter();
      if (opts.onChange) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { opts.onChange(ta.value); }, 220);
      }
    }

    ta.addEventListener('input', fire);
    ta.addEventListener('scroll', function () { gutter.scrollTop = ta.scrollTop; });

    renderGutter();

    return {
      el: shell,
      textarea: ta,
      get: function () { return ta.value; },
      set: function (v) { ta.value = v; renderGutter(); },
      focus: function () { ta.focus(); },
      flush: function () { clearTimeout(saveTimer); if (opts.onChange) opts.onChange(ta.value); }
    };
  }

  HB.Editor = { create: create };
})(window.HB = window.HB || {});
