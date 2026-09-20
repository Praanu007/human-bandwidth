/* HUMAN BANDWIDTH — content registry.
 *
 * Challenge files are plain scripts that call HB.registerSignal / registerBonus /
 * registerBuild at load time. Keeping the registry dumb means a challenge can be
 * added or pulled by editing one <script> tag, with no other file touched.
 */
(function (HB) {
  'use strict';

  var signals = [];
  var bonuses = [];
  var build = null;
  var problems = [];

  function need(obj, fields, where) {
    fields.forEach(function (f) {
      if (obj[f] == null) problems.push(where + ' is missing "' + f + '"');
    });
  }

  HB.registerSignal = function (s) {
    s.kind = 'signal';
    need(s, ['id', 'index', 'codename', 'points', 'briefing', 'artifacts', 'probe',
      'task', 'exports', 'starter', 'tests', 'hints', 'reveal'], 'signal ' + (s.id || '?'));
    signals.push(s);
  };

  HB.registerBonus = function (b) {
    b.kind = 'bonus';
    b.tier = 'bonus';
    need(b, ['id', 'codename', 'points', 'briefing', 'task', 'exports', 'starter', 'tests'],
      'bonus ' + (b.id || '?'));
    bonuses.push(b);
  };

  HB.registerBuild = function (b) {
    b.kind = 'build';
    b.id = b.id || 'FINAL-BUILD';
    b.codename = b.codename || 'TASKFLOW';
    b.points = 0;
    need(b, ['exports', 'starter', 'tests'], 'final build');
    build = b;
  };

  function seal() {
    signals.sort(function (a, b) { return a.index - b.index; });
    bonuses.sort(function (a, b) { return a.id < b.id ? -1 : 1; });

    if (!signals.length) problems.push('no signals registered');
    if (!build) problems.push('no final build registered');

    // Duplicate ids would silently overwrite run state, so fail loudly instead.
    var seen = {};
    all().forEach(function (c) {
      if (seen[c.id]) problems.push('duplicate challenge id: ' + c.id);
      seen[c.id] = true;
    });
    return problems;
  }

  function all() {
    var out = signals.concat(bonuses);
    if (build) out.push(build);
    return out;
  }

  function byId(id) {
    var hit = null;
    all().forEach(function (c) { if (c.id === id) hit = c; });
    return hit;
  }

  function visibleTests(c) { return (c.tests || []).filter(function (t) { return t.visible; }); }
  function hiddenTests(c) { return (c.tests || []).filter(function (t) { return !t.visible; }); }

  HB.content = {
    signals: function () { return signals; },
    bonuses: function () { return bonuses; },
    build: function () { return build; },
    all: all,
    byId: byId,
    visibleTests: visibleTests,
    hiddenTests: hiddenTests,
    seal: seal,
    problems: function () { return problems; }
  };
})(window.HB = window.HB || {});
