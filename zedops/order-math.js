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

  // Food is ordered from the approved recipe only. A missing recipe is zero, not the BEK guide par.
  // Supplies use the standing par set for that store. guidePar is not an input here.
  function orderNeed(item, input) {
    input = input || {};
    if (isFoodItem(item)) {
      var recipeQty = input.recipe ? Number(input.recipe.quantity) || 0 : 0;
      if (!(recipeQty > 0)) return { quantity: 0, unit: 'lb', eachFactor: null, source: 'recipe' };
      return {
        quantity: recipeQty,
        unit: (input.recipe && input.recipe.unit) || 'lb',
        eachFactor: input.recipe ? input.recipe.eachFactor : null,
        source: 'recipe'
      };
    }
    var par = Number(input.standingPar) || 0;
    var unit = input.countUnit || (item && item.countUnit) || 'each';
    if (!(par > 0)) return { quantity: 0, unit: unit, eachFactor: null, source: 'standing par' };
    return { quantity: par, unit: unit, eachFactor: null, source: 'standing par' };
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
  function filterCatalog(query, items, options) {
    var opts = options || {};
    var hidden = opts.hidden || {};
    var q = fold(query);
    var compact = q.replace(/ /g, '');
    var ranked = [];
    (items || []).forEach(function (item) {
      if (!item) return;
      if (hidden[item.id] && !opts.showHidden) return;
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

  // A row with weight defaults to Replace, so the pounds stay on the order.
  // Ignore is explicit and drops that weight.
  function planIngredientHide(row, choice) {
    var pounds = Number(row && row.pounds) || 0;
    var requested = choice && choice.mode;
    var mode = requested === 'ignore' ? 'ignore' : 'replace';
    if (!(pounds > 0) && requested !== 'replace') mode = 'ignore';
    if (mode === 'replace') {
      if (!choice || !choice.catalogId) {
        return { ok: false, defaultMode: 'replace', error: 'Pick the BEK item that should get this weight.' };
      }
      return { ok: true, hideMode: 'replace', catalogId: choice.catalogId, pounds: pounds };
    }
    return { ok: true, hideMode: 'ignore', catalogId: '', pounds: pounds };
  }

  function calendarDay(ymd) {
    var bits = String(ymd || '').split('-').map(Number);
    if (bits.length !== 3 || !bits[0] || !bits[1] || !bits[2]) return null;
    return new Date(Date.UTC(bits[0], bits[1] - 1, bits[2]));
  }

  function addCalendarDays(ymd, days) {
    var day = calendarDay(ymd);
    if (!day) return '';
    day.setUTCDate(day.getUTCDate() + days);
    var month = String(day.getUTCMonth() + 1).padStart(2, '0');
    var date = String(day.getUTCDate()).padStart(2, '0');
    return day.getUTCFullYear() + '-' + month + '-' + date;
  }

  // The saved week is the cook date. A Wednesday stays that date. Any other day
  // belongs to the order cycle whose counts are due on its Tuesday, eight days before the cook.
  function recipeWeek(cookDate) {
    var ymd = String(cookDate || '');
    var day = calendarDay(ymd);
    if (!day) return '';
    if (day.getUTCDay() === 3) return ymd;
    var countsDue = addCalendarDays(ymd, 2 - day.getUTCDay());
    return addCalendarDays(countsDue, 8);
  }

  // One approval replaces that week's lines. Ignored or unmatched rows are left out, so the weight is not ordered.
  // Matches are remembered by ingredient name, including hideMode.
  function planRecipeApproval(purchases, week) {
    var matches = {};
    var lines = {};
    (purchases || []).forEach(function (row) {
      if (!row || !row.key) return;
      var catalogId = row.hideMode === 'ignore' ? '' : (row.catalogId || '');
      var eachFactor = row.eachFactor === '' || row.eachFactor == null ? null : Number(row.eachFactor);
      matches[row.key] = {
        name: row.name || '',
        catalogId: catalogId,
        eachFactor: eachFactor,
        hideMode: row.hideMode || ''
      };
      if (row.hideMode === 'ignore' || !catalogId) return;
      lines[row.key] = {
        name: row.name || '',
        pounds: Number(row.pounds) || 0,
        unit: 'lb',
        catalogId: catalogId,
        eachFactor: eachFactor
      };
    });
    return { week: week, matches: matches, lines: lines };
  }

  // The first call takes the pending recipe. A listener or a second click gets nothing and must not write.
  function claimApproval(state) {
    if (!state || state.approvingRecipe || !state.pendingRecipe) return null;
    state.approvingRecipe = true;
    var pending = state.pendingRecipe;
    state.pendingRecipe = null;
    return pending;
  }

  return {
    canonUnit: canonUnit,
    packAmount: packAmount,
    shortfall: shortfall,
    casesToOrder: casesToOrder,
    needInCountUnit: needInCountUnit,
    isFoodItem: isFoodItem,
    orderNeed: orderNeed,
    filterCatalog: filterCatalog,
    matchCounts: matchCounts,
    suggestMatches: suggestMatches,
    planIngredientHide: planIngredientHide,
    recipeWeek: recipeWeek,
    planRecipeApproval: planRecipeApproval,
    claimApproval: claimApproval
  };
});
