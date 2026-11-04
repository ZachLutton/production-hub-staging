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
    ea: 'ea', each: 'ea', ct: 'ea', can: 'ea', cans: 'ea'
  };
  // How many of that unit are in one gallon. Milk and water are about 8.6 lb per gallon.
  var LB_PER_GAL = 8.6;
  var UNITS_PER_GAL = { gal: 1, qt: 4, pt: 8, floz: 128, l: 3.785411784, ml: 3785.411784 };
  var UNIT_LABEL = { lb: 'lb', gal: 'gal', qt: 'qt', pt: 'pt', floz: 'fl oz', l: 'L', ml: 'ml', oz: 'oz', ea: 'each', can: 'can' };
  // Net weight of one can. A #10 can is 6.5 lb. The others are the usual foodservice nets.
  var CAN_LB = { '10': 6.5, '5': 3.5, '3': 2.06, '2.5': 1.75, '2': 1.25, '303': 1, '300': 0.875 };
  var DEFAULT_STANDARDS = {
    can10: 6.5, can5: 3.5, can3: 2.06, can2_5: 1.75, can2: 1.25, can303: 1, can300: 0.875,
    gal: 8.6, qt: 2.15, honeyGal: 12, mapleGal: 11, oilGal: 7.6, wineGal: 8.5
  };
  var STANDARD_LABELS = {
    can10: '#10 CAN', can5: '#5 CAN', can3: '#3 CAN', can2_5: '#2.5 CAN', can2: '#2 CAN', can303: '#303 CAN', can300: '#300 CAN',
    gal: 'Gallon', qt: 'Quart', honeyGal: 'Honey per gallon', mapleGal: 'Maple per gallon', oilGal: 'Oil per gallon', wineGal: 'Wine per gallon'
  };
  var activeStandards = null;

  function useStandards(map) {
    activeStandards = map && typeof map === 'object' ? map : null;
  }

  function standardValue(id) {
    var saved = activeStandards && Number(activeStandards[id]);
    if (saved > 0) return saved;
    return DEFAULT_STANDARDS[id];
  }

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
    if (name.indexOf('honey') !== -1) return standardValue('honeyGal');
    if (name.indexOf('syrup') !== -1 || name.indexOf('maple') !== -1) return standardValue('mapleGal');
    if (name.indexOf('oil') !== -1) return standardValue('oilGal');
    if (name.indexOf('marsala') !== -1 || name.indexOf('wine') !== -1) return standardValue('wineGal') || 8.5;
    return standardValue('gal');
  }

  function defaultLbPer(unit, item) {
    var key = canonUnit(unit);
    if (key === 'gal') return densityLbPerGal(item);
    if (key === 'qt') {
      var name = String(item && item.name || '').toLowerCase();
      if (name.indexOf('honey') !== -1 || name.indexOf('syrup') !== -1 || name.indexOf('maple') !== -1 || name.indexOf('oil') !== -1) {
        return densityLbPerGal(item) / 4;
      }
      return standardValue('qt');
    }
    var per = UNITS_PER_GAL[key];
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

  function isKosherSalt(item) {
    var name = String(item && item.name || '').toLowerCase();
    return name.indexOf('kosher') !== -1 && name.indexOf('salt') !== -1;
  }

  function isBalsamicGlaze(item) {
    var name = String(item && item.name || '').toLowerCase();
    return name.indexOf('glaze') !== -1 && name.indexOf('balsamic') !== -1;
  }

  // each, case, lb, or gal. Kosher salt is one box, and balsamic glaze is one bottle,
  // unless an admin already chose a unit.
  function resolvedCountUnit(item) {
    if (item && item.countUnitChosen && item.countUnit) return item.countUnit;
    if (isKosherSalt(item) || isBalsamicGlaze(item)) return 'each';
    if (canEachLb(item && item.pack)) return 'each';
    var packText = String(item && item.pack || '');
    if (namePortionLb(item) && /(\d*\.\d+|\d+)\s*lb\s*case\b/i.test(packText)) return 'each';
    return volumeCountUnit(item);
  }

  function namePortionLb(item) {
    var match = String(item && item.name || '').match(/(\d+(?:\.\d+)?)\s*oz\b/i);
    if (!match) return null;
    var ounces = Number(match[1]);
    return ounces > 0 ? ounces / 16 : null;
  }

  function canEachLb(pack) {
    var text = String(pack || '');
    var match = text.match(/#\s*(\d+(?:\.\d+)?)\s*can\b/i);
    if (!match) return null;
    var weight = standardValue('can' + match[1].replace('.', '_'));
    return weight > 0 ? weight : null;
  }

  function defaultPieceLb(item) {
    var fromCan = canEachLb(item && item.pack);
    if (fromCan > 0) return fromCan;
    var pack = packAmount(item && item.pack);
    if (pack && pack.each > 0) {
      if (pack.unit === 'lb') return pack.each;
      if (pack.unit === 'oz') return pack.each / 16;
      return null;
    }
    return namePortionLb(item);
  }

  function pieceWeightLb(item, eachFactor) {
    var edited = Number(eachFactor);
    if (edited > 0) return edited;
    if (item && Number(item.lbPerUnit) > 0 && canonUnit(resolvedCountUnit(item)) === 'ea') return Number(item.lbPerUnit);
    return defaultPieceLb(item);
  }

  function boxesPerCase(pack) {
    if (!pack || !(pack.each > 0)) return 1;
    var count = pack.perCase / pack.each;
    return count > 0 ? count : 1;
  }

  function usesSuggestedRecipe(item) {
    if (!item) return false;
    if (isPantryLiquid(item) || isKosherSalt(item) || canEachLb(item && item.pack)) return true;
    return /caramelized onion|onion caramelized/i.test(item.name || '');
  }

  function isPantryLiquid(item) {
    var name = String(item && item.name || '').toLowerCase();
    if (/bleach|sanitizer|cleaner|degreaser|detergent|soap|disinfectant|rinse aid|wash treatment/.test(name)) return false;
    return /honey|syrup|oil|vinegar/.test(name);
  }

  // Glazes, sauces, and condiments are food even on a supply shelf. The shelf does not decide.
  function isGlazeSauceOrCondiment(item) {
    var name = String(item && item.name || '').toLowerCase();
    if (/bleach|sanitizer|cleaner|degreaser|detergent|soap|disinfectant|rinse aid|wash treatment/.test(name)) return false;
    return /glaze|sauce|ketchup|mustard|mayonnaise|mayo|dressing|aioli|relish|salsa|condiment/.test(name);
  }

  // "11 / 1 LB" is 11 pounds in a case. "4 / 1 GAL" is 4 gallons. "6 / .5 GAL" is 3 gallons.
  function packAmount(pack) {
    var text = String(pack || '');
    var dozenTwo = text.trim().match(/^(\d+)\s*\/\s*2$/);
    if (dozenTwo) {
      var count = Number(dozenTwo[1]);
      return { perCase: count * 2, each: 2, unit: 'lb', raw: text };
    }
    var can = text.match(/(\d*\.\d+|\d+)\s*\/\s*#\s*(\d+(?:\.\d+)?)\s*can\b/i);
    if (can) {
      var cans = Number(can[1]);
      var eachLb = canEachLb(text) || 0;
      if (eachLb > 0) {
        return { perCase: cans * eachLb, each: eachLb, unit: 'lb', cans: cans, canSize: can[2], raw: text };
      }
    }
    var match = text.match(/(\d*\.\d+|\d+)\s*\/\s*(\d*\.\d+|\d+)\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/);
    if (match) {
      return {
        perCase: Number(match[1]) * Number(match[2]),
        each: Number(match[2]),
        unit: canonUnit(match[3]),
        raw: text
      };
    }
    var loose = text.match(/(\d*\.\d+|\d+)\s*lb\s*case\b/i);
    if (!loose) return null;
    return { perCase: Number(loose[1]), each: 0, unit: 'lb', raw: text };
  }

  // Case size expressed in the unit the store counts. 4 / 128 OZ counted as gallons is 4 gal.
  function perCaseInCountUnit(pack, countUnit) {
    if (!pack || !(pack.perCase > 0)) return 1;
    var from = pack.unit;
    var to = canonUnit(countUnit);
    if (!to || from === to) return pack.perCase;
    if (from === 'oz' && to === 'lb') return pack.perCase / 16;
    if (from === 'lb' && to === 'oz') return pack.perCase * 16;
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
      return result;
    }
    if (canonUnit(unit) === 'ea') {
      var boxLb = pieceWeightLb(item, result.eachFactor);
      var piecePack = packAmount(item && item.pack);
      if (boxLb > 0) {
        result.convertedQuantity = Number(result.quantity) / boxLb;
        result.convertedUnit = piecePack && piecePack.canSize ? 'can' : (piecePack && piecePack.unit === 'oz' ? 'bottle' : 'box');
      }
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
    var countUnit = resolvedCountUnit(item);
    var have = onHand == null || onHand === '' ? 0 : Number(onHand) || 0;
    if ((need.source === 'plate list' || need.source === 'cook list') && canonUnit(need.unit) === 'ea' && canonUnit(countUnit) === 'lb') {
      var pieceLb = namePortionLb(item) || pieceWeightLb(item, need.eachFactor);
      var caseLb = pack && pack.unit === 'lb' ? pack.perCase : (pack && pack.unit === 'oz' ? pack.perCase / 16 : 0);
      if (pieceLb > 0 && caseLb > 0) return casesToOrder(Number(need.quantity) || 0, have / pieceLb, caseLb / pieceLb);
    }
    if (need.source === 'plate list' && canonUnit(need.unit) === 'ea' && canonUnit(countUnit) === 'lb' && pack && pack.unit === 'oz' && pack.each > 0) {
      var pieceLb = pack.each / 16;
      return casesToOrder(Number(need.quantity) || 0, have / pieceLb, pack.perCase / pack.each);
    }
    if (canonUnit(countUnit) === 'ea' && canonUnit(need.unit) === 'lb') {
      var boxLb = pieceWeightLb(item, need.eachFactor);
      if (boxLb > 0) {
        var perBox = boxesPerCase(pack);
        var caseLb = pack && pack.unit === 'lb' ? pack.perCase : (pack && pack.unit === 'oz' ? pack.perCase / 16 : 0);
        if (!(pack && pack.each > 0) && caseLb > 0) perBox = caseLb / boxLb;
        return casesToOrder(Number(need.quantity) / boxLb, have, perBox);
      }
    }
    if (canonUnit(countUnit) === 'case' && canonUnit(need.unit) === 'lb' && pack && (pack.unit === 'lb' || pack.unit === 'oz')) {
      var caseLb = pack.unit === 'lb' ? pack.perCase : pack.perCase / 16;
      if (caseLb > 0) return casesToOrder(Number(need.quantity) / caseLb, have, 1);
    }
    var needQty = needInCountUnit(need.quantity, need.unit, countUnit, need.eachFactor, item && item.lbPerUnit, item);
    var perCase = perCaseInCountUnit(pack, countUnit);
    return casesToOrder(needQty, have, perCase || 1);
  }

  // Dry spices and seasonings are food even though the temp zone says Dry.
  // The Saute Line shelf is that set. A name match covers the same kind of item on another shelf.
  function isBakingPantry(item) {
    var name = String(item && item.name || '').toLowerCase();
    if (/bleach|sanitizer|cleaner|degreaser|detergent|soap|disinfectant|rinse aid/.test(name)) return false;
    if (/baking powder|baking soda/.test(name)) return true;
    if (/\bextract\b|vanilla/.test(name)) return true;
    if (/\boats?\b|oatmeal|cereal oats|flour|cornmeal/.test(name)) return true;
    if (/marsala|\bwine\b|vinegar/.test(name)) return true;
    return false;
  }

  function isDrySeasoning(item) {
    var label = String(item.label || '');
    if (/saute line/i.test(label)) return true;
    var zone = String(item.tempZone || '').toLowerCase();
    if (zone.indexOf('dry') === -1) return false;
    var name = String(item.name || '');
    if (/cumin|chili powder|paprika|oregano|thyme|blackened|sesame seed|caper|chia|dill|chive|rosemary|garlic powder|onion powder|cinnamon|parsley flake/i.test(name)) return true;
    if (/pepper black|pepper red crushed/i.test(name)) return true;
    if (/kosher salt|salt sea kosher/i.test(name)) return true;
    return false;
  }

  // Food comes from the BEK temp zone, not the shelf the item sits on.
  // Refrigeration, frozen, and retail-ready (including dry retail-ready food) are food.
  // A plain Dry zone is a supply, except dry spices and seasonings.
  // An admin override on the item wins over the zone and over the spice default.
  function isFoodItem(item) {
    if (!item || item.kind === 'vendor_check') return false;
    if (item.orderRole === 'food') return true;
    if (isBakingPantry(item)) return true;
    if (item.orderRole === 'supply') return false;
    if (item.kind === 'special' && /salmon|mahi|filet/i.test(item.name || '')) return true;
    if (isDrySeasoning(item)) return true;
    if (isGlazeSauceOrCondiment(item)) return true;
    if (/caramelized onion|onion caramelized/i.test(item.name || '')) return true;
    if (canEachLb(item && item.pack)) return true;
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
      [/parsley flake|parsley dried|dried parsley/, /parsley flake/],
      [/kosher salt|salt sea kosher/, /kosher salt|salt sea kosher/],
      [/balsamic glaze|glaze balsamic/, /glaze balsamic/],
      [/caramelized onion|onion caramelized/, /onion caramelized|caramelized onion/],
      [/marinara/, /marinara/],
      [/crushed tomato|tomato crushed/, /tomato crushed/],
      [/enchilada/, /enchilada/],
      [/ketchup/, /ketchup/],
      [/fire roasted red pepper|roasted red pepper/, /red bell diced|pepper red bell/],
      [/apple sauce|applesauce/, /applesauce/],
      [/black bean/, /bean black|black bean/],
      [/baking powder/, /baking powder/],
      [/baking soda/, /baking soda/],
      [/vanilla extract|extract vanilla|vanilla/, /vanilla/],
      [/quick oat|oats quick|oatmeal|rolled oat/, /oat/],
      [/marsala|wine marsala/, /marsala/]
    ];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i][0].test(q) && rules[i][1].test(name)) return 40;
    }
    return 0;
  }

  // Food is ordered from the approved recipe only. A missing recipe is zero, not the BEK guide par.
  // A plate-list package that maps to a BEK item wins over a standing par.
  // Other supplies use the standing par set for that store. guidePar is not an input here.
  function weightSource(item) {
    if (!item) return null;
    if (Number(item.lbPerUnit) > 0) return { lb: Number(item.lbPerUnit), source: 'override', label: 'this item' };
    var canLb = canEachLb(item.pack);
    if (canLb > 0) return { lb: canLb, source: 'standard', label: 'can' };
    var named = namePortionLb(item);
    if (named > 0) return { lb: named, source: 'standard', label: 'oz in the name' };
    var pack = packAmount(item.pack);
    if (pack && pack.unit === 'oz' && pack.each > 0) return { lb: pack.each / 16, source: 'standard', label: 'pack ounces' };
    var unit = resolvedCountUnit(item);
    if (isVolumeUnit(unit)) {
      var per = defaultLbPer(unit, item);
      if (per > 0) return { lb: per, source: 'standard', label: unitLabel(unit) };
    }
    return null;
  }

  // A case count that is far from the usual order, or a need far above what is on hand.
  function orderWarning(item, cases, need, onHand) {
    var reasons = [];
    var ordered = Number(cases) || 0;
    var avg = Number(item && item.weeklyCaseAverage);
    if (ordered > 0 && avg > 0 && ordered > avg * 3 + 1e-9) {
      reasons.push(ordered + ' cs is more than 3× the usual ' + avg + ' cs');
    } else if (ordered > 10 && !(avg > 0)) {
      reasons.push(ordered + ' cs and this item has no recent order history');
    }
    var counted = canonUnit(resolvedCountUnit(item));
    var needQty = null;
    if (need && need.convertedQuantity != null && counted === 'ea') needQty = Number(need.convertedQuantity);
    else if (need && canonUnit(need.unit) === counted) needQty = Number(need.quantity);
    var have = onHand == null || onHand === '' ? null : Number(onHand);
    if (needQty > 0 && have > 0 && needQty > have * 4 && ordered > 0) {
      reasons.push('Need is more than 4× what is on hand');
    }
    return { flagged: reasons.length > 0, reasons: reasons };
  }

  function orderNeed(item, input) {
    input = input || {};
    if (input.cookList) {
      return {
        quantity: Number(input.cookList.quantity) || 0,
        unit: (input.cookList && input.cookList.unit) || 'each',
        eachFactor: null,
        source: 'cook list',
        reason: input.cookList.reason || ''
      };
    }
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
    resolvedCountUnit: resolvedCountUnit,
    defaultPieceLb: defaultPieceLb,
    canEachLb: canEachLb,
    defaultStandards: function () { return Object.assign({}, DEFAULT_STANDARDS); },
    standardLabels: function () { return Object.assign({}, STANDARD_LABELS); },
    useStandards: useStandards,
    standardValue: standardValue,
    weightSource: weightSource,
    orderWarning: orderWarning,
    isPantryLiquid: isPantryLiquid,
    usesSuggestedRecipe: usesSuggestedRecipe,
    isGlazeSauceOrCondiment: isGlazeSauceOrCondiment,
    packAmount: packAmount,
    perCaseInCountUnit: perCaseInCountUnit,
    shortfall: shortfall,
    casesToOrder: casesToOrder,
    needInCountUnit: needInCountUnit,
    needText: needText,
    orderCases: orderCases,
    isFoodItem: isFoodItem,
    isBakingPantry: isBakingPantry,
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
