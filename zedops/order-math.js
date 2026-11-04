// Order quantity: need minus on hand, in cases, always rounded up.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedOrder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var UNIT = {
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
    gal: 'gal', gallon: 'gal', gallons: 'gal',
    qt: 'qt', qts: 'qt', quart: 'qt', quarts: 'qt',
    pt: 'pt', pts: 'pt', pint: 'pt', pints: 'pt',
    floz: 'floz', fluidounce: 'floz', fluidounces: 'floz',
    l: 'l', ltr: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
    ml: 'ml', milliliter: 'ml', milliliters: 'ml',
    oz: 'oz', ounce: 'oz', ounces: 'oz',
    g: 'g', gram: 'g', grams: 'g',
    ea: 'ea', each: 'ea', ct: 'ea'
  };
  // How many of that unit are in one gallon. Milk and water are about 8.6 lb per gallon.
  var LB_PER_GAL = 8.6;
  var UNITS_PER_GAL = { gal: 1, qt: 4, pt: 8, floz: 128, l: 3.785411784, ml: 3785.411784 };
  var UNIT_LABEL = { lb: 'lb', gal: 'gal', qt: 'qt', pt: 'pt', floz: 'fl oz', l: 'L', ml: 'ml', oz: 'oz', ea: 'each' };

  function canonUnit(value) {
    var key = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
    return UNIT[key] || key || '';
  }

  function isVolumeUnit(unit) {
    return Object.prototype.hasOwnProperty.call(UNITS_PER_GAL, canonUnit(unit));
  }

  function unitLabel(unit) {
    var key = canonUnit(unit);
    return UNIT_LABEL[key] || key || '';
  }

  // Pounds in one count unit. An item override wins. Otherwise volume uses 8.6 lb/gal.
  // Honey, maple, oil, and milk/water are different weights per gallon.
  // An admin lb-per-unit override replaces this.
  function densityLbPerGal(item) {
    var name = String(item && item.name || '').toLowerCase();
    if (name.indexOf('honey') !== -1) return 12;
    if (name.indexOf('syrup') !== -1 || name.indexOf('maple') !== -1) return 11;
    if (name.indexOf('oil') !== -1) return 7.6;
    return LB_PER_GAL;
  }

  function defaultLbPer(unit, item) {
    var per = UNITS_PER_GAL[canonUnit(unit)];
    if (!per) return null;
    return densityLbPerGal(item) / per;
  }

  function lbPerOf(unit, override, item) {
    var custom = Number(override);
    if (custom > 0) return custom;
    return defaultLbPer(unit, item);
  }

  // A gallon or quart pack is counted in that volume, even if the stored count unit says each.
  function volumeCountUnit(item) {
    var pack = packAmount(item && item.pack);
    var unit = item && item.countUnit;
    if (pack && isVolumeUnit(pack.unit)) {
      if (unit && isVolumeUnit(unit)) return unit;
      return pack.unit;
    }
    return unit || (pack && pack.unit) || 'each';
  }

  function isPantryLiquid(item) {
    var name = String(item && item.name || '').toLowerCase();
    if (/bleach|sanitizer|cleaner|degreaser|detergent|soap|disinfectant|rinse aid|wash treatment/.test(name)) return false;
    return /honey|syrup|oil|vinegar/.test(name);
  }

  // "11 / 1 LB" is 11 pounds in a case. "4 / 1 GAL" is 4 gallons. "6 / .5 GAL" is 3 gallons.
  function packAmount(pack) {
    var text = String(pack || '');
    var match = text.match(/(\d*\.\d+|\d+)\s*\/\s*(\d*\.\d+|\d+)\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/);
    if (!match) return null;
    return {
      perCase: Number(match[1]) * Number(match[2]),
      each: Number(match[2]),
      unit: canonUnit(match[3]),
      raw: text
    };
  }

  // Case size expressed in the unit the store counts. 4 / 128 OZ counted as gallons is 4 gal.
  function perCaseInCountUnit(pack, countUnit) {
    if (!pack || !(pack.perCase > 0)) return 1;
    var from = pack.unit;
    var to = canonUnit(countUnit);
    if (!to || from === to) return pack.perCase;
    if (from === 'oz' && isVolumeUnit(to) && pack.each === 128) from = 'floz';
    if (isVolumeUnit(from) && isVolumeUnit(to)) {
      var converted = pack.perCase / UNITS_PER_GAL[from] * UNITS_PER_GAL[to];
      if (converted > 0) return converted;
    }
    return 1;
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

  function roundQty(number) {
    if (!isFinite(number)) return '';
    if (Math.abs(number - Math.round(number)) < 1e-9) return String(Math.round(number));
    return String(Math.round(number * 100) / 100);
  }

  function roundApprox(number) {
    var n = Math.round(Number(number) * 10) / 10;
    if (!isFinite(n)) return '';
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return String(n);
  }

  // Recipe pounds (or eaches) expressed in the unit the store counts.
  // lbPerUnit is an optional pounds-per-count-unit override for a volume pack.
  function needInCountUnit(quantity, quantityUnit, countUnit, eachFactor, lbPerUnit, item) {
    var qty = Number(quantity) || 0;
    var from = canonUnit(quantityUnit);
    var to = canonUnit(countUnit);
    if (!to || from === to) return qty;
    var factor = Number(eachFactor);
    if (from === 'lb' && to === 'ea' && factor > 0) return qty / factor;
    if (from === 'ea' && to === 'lb' && factor > 0) return qty * factor;
    if (to === 'case' && factor > 0) return qty / factor;
    if (from === 'lb' && isVolumeUnit(to)) {
      var per = lbPerOf(to, lbPerUnit, item);
      if (per > 0) return qty / per;
    }
    if (from === 'g') return needInCountUnit(qty / 453.59237, 'lb', countUnit, eachFactor, lbPerUnit);
    if (from === 'lb' && to === 'oz') return qty * 16;
    if (from === 'oz' && to === 'lb') return qty / 16;
    return qty;
  }

  function withVolume(item, result, countUnit) {
    var unit = countUnit || (item && item.countUnit) || '';
    if (!result || canonUnit(result.unit) !== 'lb') return result;
    if (isVolumeUnit(unit)) {
      result.convertedQuantity = needInCountUnit(result.quantity, result.unit, unit, result.eachFactor, item && item.lbPerUnit, item);
      result.convertedUnit = unitLabel(unit);
      var pack = packAmount(item && item.pack);
      if (pack && canonUnit(pack.unit) === canonUnit(unit) && pack.each > 0 && pack.each !== 1) {
        result.pieceQuantity = result.convertedQuantity / pack.each;
        result.pieceSize = pack.each;
        result.pieceUnit = unitLabel(unit);
      }
      return result;
    }
    if (canonUnit(unit) === 'oz') {
      result.convertedQuantity = needInCountUnit(result.quantity, result.unit, unit, result.eachFactor, item && item.lbPerUnit, item);
      result.convertedUnit = 'oz';
    }
    return result;
  }

  function needText(need) {
    if (!need) return '';
    var text = roundQty(need.quantity) + (need.unit ? ' ' + unitLabel(need.unit) : '');
    if (need.convertedQuantity != null && need.convertedUnit) {
      text += ' ≈ ' + roundApprox(need.convertedQuantity) + ' ' + need.convertedUnit;
    }
    if (need.pieceQuantity != null && need.pieceUnit) {
      text += ' · ' + roundApprox(need.pieceQuantity) + ' × ' + roundApprox(need.pieceSize) + ' ' + need.pieceUnit;
    }
    return text;
  }

  // Need and on hand are both in the count unit. Cases round up.
  function orderCases(item, need, onHand) {
    if (!need) return 0;
    var pack = packAmount(item && item.pack);
    var countUnit = volumeCountUnit(item);
    var needQty = needInCountUnit(need.quantity, need.unit, countUnit, need.eachFactor, item && item.lbPerUnit, item);
    var perCase = perCaseInCountUnit(pack, countUnit);
    var have = onHand == null || onHand === '' ? 0 : Number(onHand) || 0;
    return casesToOrder(needQty, have, perCase || 1);
  }

  // Dry spices and seasonings are food even though the temp zone says Dry.
  // The Saute Line shelf is that set. A name match covers the same kind of item on another shelf.
  function isDrySeasoning(item) {
    var label = String(item.label || '');
    if (/saute line/i.test(label)) return true;
    var zone = String(item.tempZone || '').toLowerCase();
    if (zone.indexOf('dry') === -1) return false;
    var name = String(item.name || '');
    if (/cumin|chili powder|paprika|oregano|thyme|blackened|sesame seed|caper|chia|dill|chive|rosemary|garlic powder|onion powder|cinnamon|parsley flake/i.test(name)) return true;
    if (/pepper black|pepper red crushed/i.test(name)) return true;
    return false;
  }

  // Food comes from the BEK temp zone, not the shelf the item sits on.
  // Refrigeration, frozen, and retail-ready (including dry retail-ready food) are food.
  // A plain Dry zone is a supply, except dry spices and seasonings.
  // An admin override on the item wins over the zone and over the spice default.
  function isFoodItem(item) {
    if (!item || item.kind === 'vendor_check') return false;
    if (item.orderRole === 'food') return true;
    if (item.orderRole === 'supply') return false;
    if (item.kind === 'special' && /salmon|mahi|filet/i.test(item.name || '')) return true;
    if (isDrySeasoning(item)) return true;
    var zone = String(item.tempZone || '').toLowerCase();
    if (zone.indexOf('retail ready') !== -1) return true;
    if (zone.indexOf('refriger') !== -1) return true;
    if (zone.indexOf('frozen') !== -1 || zone.indexOf('freezer') !== -1) return true;
    return false;
  }

  // A distinctive spice word is enough to offer that catalog item. "Pepper" alone is not.
  function spiceScore(query, item) {
    var q = fold(query);
    var name = fold(item && item.name);
    var rules = [
      [/cumin/, /cumin/],
      [/chili powder/, /chili powder/],
      [/paprika/, /paprika/],
      [/crushed red|red pepper flake|pepper red crushed/, /pepper red crushed/],
      [/black pepper|pepper black/, /pepper black/],
      [/oregano/, /oregano/],
      [/thyme/, /thyme/],
      [/blackened|redfish magic/, /blackened/],
      [/maple/, /maple|syrup/],
      [/sesame oil|oil sesame/, /oil sesame/],
      [/lime juice/, /juice lime|lime juice/],
      [/sesame seed/, /sesame seed/],
      [/caper/, /caper/],
      [/chia/, /chia/],
      [/dill/, /dill/],
      [/chive/, /chive/],
      [/rosemary/, /rosemary/],
      [/garlic powder/, /garlic powder/],
      [/onion powder/, /onion powder/],
      [/cinnamon/, /cinnamon/],
      [/parsley flake|parsley dried|dried parsley/, /parsley flake/]
    ];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i][0].test(q) && rules[i][1].test(name)) return 40;
    }
    return 0;
  }

  // Food is ordered from the approved recipe only. A missing recipe is zero, not the BEK guide par.
  // A plate-list package that maps to a BEK item wins over a standing par.
  // Other supplies use the standing par set for that store. guidePar is not an input here.
  function orderNeed(item, input) {
    input = input || {};
    if (input.plateList) {
      return {
        quantity: Number(input.plateList.quantity) || 0,
        unit: (input.plateList && input.plateList.unit) || 'each',
        eachFactor: null,
        source: 'plate list',
        reason: input.plateList.reason || ''
      };
    }
    if (isFoodItem(item) || input.forceFood) {
      var recipeQty = input.recipe ? Number(input.recipe.quantity) || 0 : 0;
      if (!(recipeQty > 0)) return { quantity: 0, unit: 'lb', eachFactor: null, source: 'recipe' };
      return withVolume(item, {
        quantity: recipeQty,
        unit: (input.recipe && input.recipe.unit) || 'lb',
        eachFactor: input.recipe ? input.recipe.eachFactor : null,
        source: 'recipe'
      }, input.countUnit || (item && item.countUnit));
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
      var spice = spiceScore(query, item);
      if (spice > score) score = spice;
      // solidOnly keeps a real hit (item number, full phrase, or every word). A loose
      // letter match stays available in the search box and is never pre-selected.
      if (score && !(opts.solidOnly && score < 30)) ranked.push({ item: item, score: score, name: item.name || '' });
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

  // One approval replaces that week's lines. A suggestion is not a match: only a row
  // the user already confirmed is written to the ingredient map or the week's order.
  function planRecipeApproval(purchases, week) {
    var matches = {};
    var lines = {};
    (purchases || []).forEach(function (row) {
      if (!row || !row.key || (row.matchSaved !== true && row.includeInOrder !== true)) return;
      var catalogId = row.hideMode === 'ignore' ? '' : (row.catalogId || '');
      var eachFactor = row.eachFactor === '' || row.eachFactor == null ? null : Number(row.eachFactor);
      if (row.matchSaved === true) {
        matches[row.key] = {
          name: row.name || '',
          catalogId: catalogId,
          eachFactor: eachFactor,
          hideMode: row.hideMode || ''
        };
      }
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
    isVolumeUnit: isVolumeUnit,
    unitLabel: unitLabel,
    defaultLbPer: defaultLbPer,
    volumeCountUnit: volumeCountUnit,
    isPantryLiquid: isPantryLiquid,
    packAmount: packAmount,
    perCaseInCountUnit: perCaseInCountUnit,
    shortfall: shortfall,
    casesToOrder: casesToOrder,
    needInCountUnit: needInCountUnit,
    needText: needText,
    orderCases: orderCases,
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
