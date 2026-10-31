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

  function suggestMatches(ingredientName, items, limit) {
    var needle = String(ingredientName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    var tokens = needle.split(' ').filter(function (word) { return word.length > 2; });
    var ranked = (items || []).map(function (item) {
      var hay = (item.name + ' ' + (item.brand || '')).toLowerCase();
      var score = 0;
      if (hay.indexOf(needle) !== -1 && needle.length > 3) score += 5;
      tokens.forEach(function (word) { if (hay.indexOf(word) !== -1) score += 1; });
      return { item: item, score: score };
    }).filter(function (row) { return row.score > 0; });
    ranked.sort(function (a, b) { return b.score - a.score; });
    return ranked.slice(0, limit || 3).map(function (row) { return row.item; });
  }

  return {
    canonUnit: canonUnit,
    packAmount: packAmount,
    shortfall: shortfall,
    casesToOrder: casesToOrder,
    needInCountUnit: needInCountUnit,
    isFoodItem: isFoodItem,
    suggestMatches: suggestMatches
  };
});
