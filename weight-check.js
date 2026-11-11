// Plate weight checks for the Production Hub.
// No Firebase and no inventory code. The page and node:test both load this file.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WeightCheck = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var DEFAULT_TOLERANCE = 20;
  var CHECKS = [
    { number: 1, label: '8th plate on the first tray' },
    { number: 2, label: 'a plate from a middle tray' }
  ];
  var RULE = 'Out of range: fix the portion, recheck the next plate, circle it.';

  function roundGrams(value) {
    var n = Number(value);
    if (!isFinite(n)) return null;
    return Math.round(n);
  }

  function parseServingSize(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return null;
    var labeled = text.match(/serving\s*size\s*\(\s*(\d+(?:\.\d+)?)\s*g\s*\)/i);
    if (labeled) return roundGrams(labeled[1]);
    var grams = text.match(/(\d+(?:\.\d+)?)\s*g\b/i);
    if (grams && /serving/i.test(text)) return roundGrams(grams[1]);
    if (/^\d+(?:\.\d+)?$/.test(text)) return roundGrams(text);
    return null;
  }

  function toleranceOf(setting) {
    var n = setting && setting.tolerance != null ? roundGrams(setting.tolerance) : DEFAULT_TOLERANCE;
    if (n == null || n < 0) return DEFAULT_TOLERANCE;
    return n;
  }

  function targetOf(setting) {
    if (!setting || setting.target == null || setting.target === '') return null;
    var n = roundGrams(setting.target);
    if (n == null || n <= 0) return null;
    return n;
  }

  function passRange(target, tolerance) {
    var t = roundGrams(target);
    var tol = tolerance == null ? DEFAULT_TOLERANCE : roundGrams(tolerance);
    if (t == null || tol == null || tol < 0) return null;
    return { low: t - tol, high: t + tol, target: t, tolerance: tol };
  }

  function judge(weight, target, tolerance) {
    if (weight == null || weight === '') return null;
    var grams = roundGrams(weight);
    var range = passRange(target, tolerance);
    if (grams == null || !range) return null;
    var pass = grams >= range.low && grams <= range.high;
    return { weight: grams, pass: pass, result: pass ? 'pass' : 'fail', low: range.low, high: range.high };
  }

  function platingSequence(dayData) {
    var order = ['Station 1', 'Station 2', 'Station 3', 'Station 4', 'Station 5'];
    var rows = [];
    function take(stationName) {
      var station = dayData && dayData[stationName];
      var dishes = station && station.dishes;
      if (!Array.isArray(dishes)) return;
      dishes.forEach(function (dish, index) {
        if (!dish || !dish.name) return;
        rows.push({
          station: stationName,
          index: index,
          name: String(dish.name),
          ordered: Math.max(0, roundGrams(dish.ordered) || 0)
        });
      });
    }
    order.forEach(take);
    if (!rows.length) take('Queue');
    return rows;
  }

  function sheetBlocks(sequence, targets) {
    return (sequence || []).map(function (row, order) {
      var setting = (targets && targets[row.name]) || {};
      var target = targetOf(setting);
      var tolerance = toleranceOf(setting);
      var range = target == null ? null : passRange(target, tolerance);
      return {
        order: order + 1,
        station: row.station,
        name: row.name,
        target: target,
        tolerance: tolerance,
        low: range ? range.low : null,
        high: range ? range.high : null,
        checks: CHECKS.map(function (check) { return { number: check.number, label: check.label }; })
      };
    });
  }

  function recordCheck(input, targets) {
    var name = String(input && input.dish || '').trim();
    var check = roundGrams(input && input.check);
    var setting = (targets && targets[name]) || {};
    var target = targetOf(setting);
    var tolerance = toleranceOf(setting);
    var weight = judge(input && input.weight, target, tolerance);
    var recheckRaw = input && input.recheck;
    var recheck = recheckRaw == null || String(recheckRaw).trim() === '' ? null : judge(recheckRaw, target, tolerance);
    if (!name) return { ok: false, error: 'Choose a dish.' };
    if (check !== 1 && check !== 2) return { ok: false, error: 'Check is 1 or 2.' };
    if (target == null) return { ok: false, error: 'Set a target weight for this dish first.' };
    if (!weight) return { ok: false, error: 'Enter the weight in grams.' };
    var plater = String(input.plater || '').trim();
    var checker = String(input.checker || '').trim();
    if (!plater || !checker) return { ok: false, error: 'Enter plater and checker initials.' };
    return {
      ok: true,
      entry: {
        day: String(input.day || ''),
        dish: name,
        check: check,
        weight: weight.weight,
        result: weight.result,
        low: weight.low,
        high: weight.high,
        target: target,
        tolerance: tolerance,
        plater: plater,
        checker: checker,
        recheck: recheck ? recheck.weight : null,
        recheckResult: recheck ? recheck.result : null
      }
    };
  }

  function isMiss(entry, which) {
    if (!entry) return false;
    if (which === 'recheck') return entry.recheckResult === 'fail';
    return entry.result === 'fail';
  }

  function missSummary(checks) {
    var byPlater = {};
    var byDish = {};
    (checks || []).forEach(function (entry) {
      [['weight', entry.result, entry.plater, entry.dish], ['recheck', entry.recheckResult, entry.plater, entry.dish]].forEach(function (part) {
        if (part[1] !== 'fail') return;
        var plater = part[2] || 'Unknown';
        var dish = part[3] || 'Unknown';
        byPlater[plater] = (byPlater[plater] || 0) + 1;
        byDish[dish] = (byDish[dish] || 0) + 1;
      });
    });
    function rows(map) {
      return Object.keys(map).map(function (name) { return { name: name, misses: map[name] }; })
        .sort(function (a, b) { return b.misses - a.misses || a.name.localeCompare(b.name); });
    }
    return { byPlater: rows(byPlater), byDish: rows(byDish) };
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function rangeText(block) {
    if (block.target == null) return 'Target not set';
    return block.low + '–' + block.high + 'g';
  }

  function printDocument(dayLabel, blocks) {
    var body = (blocks || []).map(function (block) {
      var checks = block.checks.map(function (check) {
        return '<div class="check"><div class="check-title">Check ' + check.number + ' — ' + esc(check.label) + '</div>' +
          '<div class="lines">Weight (g) ________ &nbsp;&nbsp; Plater ________ &nbsp;&nbsp; Checker ________</div></div>';
      }).join('');
      return '<section class="block"><h2>' + block.order + '. ' + esc(block.name) + '</h2>' +
        '<p class="meta">' + esc(block.station) + ' &nbsp; Target ' + (block.target == null ? '____' : block.target + 'g') +
        ' &nbsp; Pass ' + esc(rangeText(block)) + '</p>' + checks + '</section>';
    }).join('');
    if (!body) body = '<p>No dishes are on this day yet.</p>';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Weight check — ' + esc(dayLabel) + '</title>' +
      '<style>body{font-family:Georgia,serif;color:#111;margin:24px;}h1{font-size:22px;margin:0 0 4px;} .rule{font-size:14px;font-weight:700;margin:0 0 16px;} .block{break-inside:avoid;border:1px solid #222;border-radius:8px;padding:10px 12px;margin:0 0 12px;} h2{font-size:16px;margin:0 0 4px;} .meta{margin:0 0 8px;font-size:13px;} .check{margin:8px 0 0;} .check-title{font-weight:700;font-size:13px;} .lines{font-size:14px;margin-top:4px;letter-spacing:0.2px;}</style></head><body>' +
      '<h1>Weight check — ' + esc(dayLabel) + '</h1>' +
      '<p class="rule">' + esc(RULE) + '</p>' + body + '</body></html>';
  }

  function resultLabel(result) {
    if (result === 'pass') return 'Pass';
    if (result === 'fail') return 'Miss';
    return '';
  }

  function reportHtml(options) {
    var checks = (options && options.checks) || [];
    var days = options && options.days;
    var shown = days && days.length ? checks.filter(function (entry) { return days.indexOf(entry.day) !== -1; }) : checks;
    var summary = missSummary(checks);
    function list(rows, empty) {
      if (!rows.length) return '<p class="weight-empty">' + empty + '</p>';
      return '<ul>' + rows.map(function (row) {
        return '<li><strong>' + esc(row.name) + '</strong> — ' + row.misses + ' miss' + (row.misses === 1 ? '' : 'es') + '</li>';
      }).join('') + '</ul>';
    }
    var table = '<p class="weight-empty">No weights entered for this day.</p>';
    if (shown.length) {
      table = '<table class="weight-table"><thead><tr><th>Day</th><th>Dish</th><th>Check</th><th>Weight</th><th>Pass range</th><th>Result</th><th>Plater</th><th>Checker</th><th>Recheck</th></tr></thead><tbody>' +
        shown.map(function (entry) {
          var miss = entry.result === 'fail' || entry.recheckResult === 'fail';
          var recheck = entry.recheck == null ? '' : entry.recheck + 'g ' + resultLabel(entry.recheckResult);
          return '<tr class="' + (miss ? 'weight-miss' : '') + '"><td>' + esc(entry.day) + '</td><td>' + esc(entry.dish) +
            '</td><td>' + entry.check + '</td><td>' + entry.weight + 'g</td><td>' + entry.low + '–' + entry.high +
            'g</td><td>' + resultLabel(entry.result) + '</td><td>' + esc(entry.plater) + '</td><td>' + esc(entry.checker) +
            '</td><td>' + esc(recheck) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    return '<section class="weight-report"><h3>Weight checks</h3>' + table +
      '<h3>Misses by plater</h3>' + list(summary.byPlater, 'No misses by plater.') +
      '<h3>Misses by dish</h3>' + list(summary.byDish, 'No misses by dish.') + '</section>';
  }

  return {
    DEFAULT_TOLERANCE: DEFAULT_TOLERANCE,
    CHECKS: CHECKS,
    RULE: RULE,
    parseServingSize: parseServingSize,
    passRange: passRange,
    judge: judge,
    platingSequence: platingSequence,
    sheetBlocks: sheetBlocks,
    recordCheck: recordCheck,
    isMiss: isMiss,
    missSummary: missSummary,
    printDocument: printDocument,
    reportHtml: reportHtml
  };
});
