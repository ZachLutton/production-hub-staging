// Reads a plate-list layout. The PDF reader hands this the same kind of text.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedPlate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function nameKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
  }

  function skipLine(line) {
    var trimmed = String(line || '').trim();
    if (!trimmed) return true;
    if (/Plate List for|Generated on|Small\s+Regular/i.test(trimmed)) return true;
    return false;
  }

  // "300 (ea)" is a piece count. The unit is not part of the number.
  function stripCountUnit(line) {
    return String(line || '').replace(/\s*\(\s*ea\s*\)\s*$/i, '').replace(/\s+\bea\b\s*$/i, '');
  }

  // One count, or Small + Regular + Large. The name stays in front of those columns.
  function columnCount(line) {
    line = stripCountUnit(line);
    var match = String(line || '').trim().match(/^(.*?)\s+(\d[\d,]*(?:\s+\d[\d,]*)*)$/);
    if (!match) return null;
    var name = match[1].trim();
    if (!name || !/[A-Za-z]/.test(name)) return null;
    var count = 0;
    match[2].split(/\s+/).forEach(function (token) {
      count += Number(token.replace(/,/g, '')) || 0;
    });
    return count > 0 ? { name: name, count: count } : null;
  }

  // A count that pdf.js dropped onto its own line under the dish name.
  function numbersOnly(line) {
    var trimmed = stripCountUnit(line).trim();
    if (!/^\d[\d,\s]*$/.test(trimmed)) return null;
    var count = 0;
    trimmed.split(/\s+/).forEach(function (token) {
      if (!token) return;
      count += Number(token.replace(/,/g, '')) || 0;
    });
    return count > 0 ? count : null;
  }

  function parsePlateList(text) {
    var raw = String(text || '').replace(/\f/g, '\n');
    var cookDate = '';
    var cookMatch = raw.match(/Plate List for\s+[A-Za-z]+\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i);
    if (cookMatch) {
      var month = MONTHS[cookMatch[1].toLowerCase()];
      if (month) cookDate = cookMatch[3] + '-' + pad(month) + '-' + pad(cookMatch[2]);
    }
    var totalCook = null;
    var lines = raw.split(/\n/);
    var dishes = [];
    var seen = {};
    var pending = null;
    function flush() {
      if (pending && pending.count > 0) addDish(pending.name, pending.count);
      pending = null;
    }
    function addDish(name, count) {
      var key = nameKey(name);
      if (!key || !(count > 0)) return;
      if (!seen[key]) {
        seen[key] = { key: key, name: name, count: 0 };
        dishes.push(seen[key]);
      }
      seen[key].count += count;
    }
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i] || '');
      if (/Total Cook/i.test(line)) {
        var same = line.match(/Total Cook\s*:?\s*([\d,]+)/i);
        var next = !same && lines[i + 1] ? String(lines[i + 1]).match(/([\d,]{2,})\s*$/) : null;
        var token = same ? same[1] : (next ? next[1] : '');
        if (token && totalCook == null) {
          var headerCount = Number(token.replace(/,/g, ''));
          if (isFinite(headerCount)) totalCook = headerCount;
        }
        continue;
      }
      if (skipLine(line)) continue;
      var alone = numbersOnly(line);
      if (alone != null && !/[A-Za-z]/.test(stripCountUnit(line))) {
        if (pending) pending.count += alone;
        continue;
      }
      var cols = columnCount(line);
      if (cols) {
        flush();
        addDish(cols.name, cols.count);
        continue;
      }
      var named = String(line).trim();
      if (/[A-Za-z]/.test(named)) {
        flush();
        pending = { name: named, count: 0 };
      }
    }
    flush();
    return { cookDate: cookDate, totalCook: totalCook, dishes: dishes };
  }

  function dishList(plate) {
    if (!plate || !plate.dishes) return [];
    if (Array.isArray(plate.dishes)) {
      return plate.dishes.filter(function (dish) { return dish && (Number(dish.count) || 0) > 0; });
    }
    return Object.keys(plate.dishes).map(function (key) {
      var row = plate.dishes[key] || {};
      return { key: key, name: row.name || key, count: Number(row.count) || 0 };
    }).filter(function (dish) { return dish.count > 0; });
  }

  // A saved plate that kept Total Cook and the PDF text, but lost the dish lines.
  function deriveFromStored(plate) {
    if (!plate || dishList(plate).length) return null;
    if (!plate.sourceText) return null;
    var parsed = parsePlateList(plate.sourceText);
    if (!parsed.dishes.length) return null;
    var total = parsed.totalCook != null ? parsed.totalCook : plate.totalCook;
    return {
      cookDate: plate.cookDate || parsed.cookDate || '',
      totalCook: total,
      dishes: parsed.dishes,
      fileName: plate.fileName || '',
      approvedAt: plate.approvedAt || '',
      sourceText: plate.sourceText
    };
  }

  return {
    parsePlateList: parsePlateList,
    nameKey: nameKey,
    dishList: dishList,
    deriveFromStored: deriveFromStored
  };
});
