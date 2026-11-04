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
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i] || '');
      if (/Total Cook/i.test(line)) {
        var same = line.match(/Total Cook\s*:?\s*([\d,]+)/i);
        var next = !same && lines[i + 1] ? String(lines[i + 1]).match(/([\d,]{3,})\s*$/) : null;
        var token = same ? same[1] : (next ? next[1] : '');
        if (token && totalCook == null) {
          var headerCount = Number(token.replace(/,/g, ''));
          if (isFinite(headerCount)) totalCook = headerCount;
        }
        continue;
      }
      var trimmed = line.trim();
      if (!trimmed || /Plate List for|Generated on|Small\s+Regular/i.test(trimmed)) continue;
      var dish = trimmed.match(/^(.+?)\s+([\d,]+)\s*$/);
      if (!dish) continue;
      var name = dish[1].trim();
      var count = Number(dish[2].replace(/,/g, ''));
      if (!name || !isFinite(count)) continue;
      var key = nameKey(name);
      if (!key || seen[key]) continue;
      seen[key] = true;
      dishes.push({ key: key, name: name, count: count });
    }
    return { cookDate: cookDate, totalCook: totalCook, dishes: dishes };
  }

  return { parsePlateList: parsePlateList, nameKey: nameKey };
});
