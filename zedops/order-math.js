// Order quantity: need minus on hand, in cases, always rounded up.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedOrder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var UNIT = { lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', gal: 'gal', gallon: 'gal', oz: 'oz', ounce: 'oz', ea: 'ea', each: 'ea', ct: 'ea' };

  function canonUnit(value) {
    var key = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
    return UNIT[key] || key || '';
  }

  // "11 / 1 LB" is 11 pounds in a case. "4 / 3 LB" is 12 pounds in a case.
  function packAmount(pack) {
    var match = String(pack || '').match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)/);
    if (!match) return null;
    return { perCase: Number(match[1]) * Number(match[2]), unit: canonUnit(match[3]) };
  }

  function shortfall(need, onHand) {
    var gap = (Number(need) || 0) - (Number(onHand) || 0);
    return gap > 0 ? gap : 0;
  }

  // Never rounds down. An exact case stays exact. A fraction of a case becomes the next case.
  function casesToOrder(need, onHand, perCase) {
    var gap = shortfall(need, onHand);
    if (!(gap > 0)) return 0;
    var size = Number(perCase);
    if (!(size > 0)) return Math.ceil(gap - 1e-9);
    return Math.ceil(gap / size - 1e-9);
  }

  // Recipe pounds (or eaches) expressed in the unit the store counts.
  function needInCountUnit(quantity, quantityUnit, countUnit, eachFactor) {
    var qty = Number(quantity) || 0;
    var from = canonUnit(quantityUnit);
    var to = canonUnit(countUnit);
    if (!to || from === to) return qty;
    var factor = Number(eachFactor);
    if (from === 'lb' && to === 'ea' && factor > 0) return qty / factor;
    if (from === 'ea' && to === 'lb' && factor > 0) return qty * factor;
    if (to === 'case' && factor > 0) return qty / factor;
    return qty;
  }

  var FOOD_LABELS = {
    'walk-in cooler': true,
    produce: true,
    meat: true,
    'saute line': true,
    'spice rack': true,
    'kitchen dry supplies': true,
    freezer: true
  };

  function isFoodItem(item) {
    if (!item || item.kind === 'vendor_check') return false;
    var label = String(item.label || '').toLowerCase();
    if (FOOD_LABELS[label]) return true;
    return item.kind === 'special' && /salmon|mahi|filet/i.test(item.name || '');
  }

  function fold(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function fuzzy(needle, hay) {
    if (!needle || needle.length < 4) return false;
    var i = 0;
    var first = -1;
    var last = -1;
    for (var c = 0; c < hay.length && i < needle.length; c++) {
      if (hay.charAt(c) === needle.charAt(i)) {
        if (first < 0) first = c;
        last = c;
        i++;
      }
    }
    return i === needle.length && (last - first) <= needle.length * 3;
  }

  function tokenHit(token, hay) {
    if (!token) return false;
    if (hay.indexOf(token) !== -1) return true;
    var words = hay.split(' ');
    for (var i = 0; i < words.length; i++) {
      if (words[i].indexOf(token) === 0) return true;
    }
    return false;
  }

  // Case-insensitive search across item name, brand, and item number.
  function filterCatalog(query, items) {
    var q = fold(query);
    var compact = q.replace(/ /g, '');
    var ranked = [];
    (items || []).forEach(function (item) {
      if (!item) return;
      var name = fold(item.name);
      var brand = fold(item.brand);
      var num = String(item.itemNumber || '').toLowerCase().replace(/\s+/g, '');
      var hay = fold(name + ' ' + brand + ' ' + num);
      var flat = hay.replace(/ /g, '');
      var score = 0;
      if (!q) score = 1;
      else if (num && compact && num.indexOf(compact) !== -1) score = 80;
      else if (hay.indexOf(q) !== -1) score = 50;
      else {
        var tokens = q.split(' ').filter(Boolean);
        var hit = tokens.filter(function (token) { return tokenHit(token, hay); }).length;
        if (tokens.length && hit === tokens.length) score = 30;
        else if (fuzzy(compact, flat)) score = 10;
      }
      if (score) ranked.push({ item: item, score: score, name: item.name || '' });
    });
    ranked.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return ranked.map(function (row) { return row.item; });
  }

  function matchCounts(rows) {
    var matched = 0;
    var unmatched = 0;
    (rows || []).forEach(function (row) {
      if (row && row.catalogId) matched += 1;
      else unmatched += 1;
    });
    return { matched: matched, unmatched: unmatched, total: matched + unmatched };
  }

  function suggestMatches(ingredientName, items, limit) {
    return filterCatalog(ingredientName, items).slice(0, limit || 3);
  }

  return {
    canonUnit: canonUnit,
    packAmount: packAmount,
    shortfall: shortfall,
    casesToOrder: casesToOrder,
    needInCountUnit: needInCountUnit,
    isFoodItem: isFoodItem,
    filterCatalog: filterCatalog,
    matchCounts: matchCounts,
    suggestMatches: suggestMatches
  };
});
