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
    for (var i = 0; i < lines.length; i++) {
      if (!/Total Cook/i.test(lines[i])) continue;
      var same = lines[i].match(/Total Cook\s*:?\s*([\d,]+)/i);
      var next = !same && lines[i + 1] ? String(lines[i + 1]).match(/([\d,]{3,})\s*$/) : null;
      var token = same ? same[1] : (next ? next[1] : '');
      if (!token) continue;
      var number = Number(token.replace(/,/g, ''));
      if (isFinite(number)) { totalCook = number; break; }
    }
    return { cookDate: cookDate, totalCook: totalCook };
  }

  return { parsePlateList: parsePlateList };
});
