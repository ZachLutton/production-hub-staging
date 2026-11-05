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
    ea: 'ea', each: 'ea', ct: 'ea',
    jar: 'jar', jars: 'jar', can: 'can', cans: 'can',
    carton: 'carton', cartons: 'carton', tub: 'tub', tubs: 'tub',
    case: 'case', cs: 'case'
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

  function isPieceCountUnit(unit) {
    var key = canonUnit(unit);
    return key === 'ea' || key === 'jar' || key === 'can' || key === 'carton' || key === 'tub';
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

  function fluidCarton(pack) {
    var parsed = packAmount(pack);
    return !!(parsed && parsed.unit === 'oz' && (parsed.each === 64 || parsed.each === 128));
  }

  // Spice-rack and pantry packs of N / X OZ are counted by the container, not by the ounce.
  // 12 / 42 OZ oats are 2.625 lb containers. 6 / 32 OZ capers are 2 lb jars.
  function isJarSpice(item) {
    var pack = packAmount(item && item.pack);
    if (!pack || pack.unit !== 'oz' || !(pack.each > 0)) return false;
    if (pack.each === 64 || pack.each === 128) return false;
    if (String(item && item.itemNumber || '') === '774477') return false;
    var label = String(item && item.label || '');
    if (/saute line|spice rack/i.test(label)) return true;
    if (isBakingPantry(item)) return true;
    return /caper/i.test(String(item && item.name || ''));
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
    if (item && item.countUnitChosen && item.countUnit && !(canonUnit(item.countUnit) === 'oz' && isJarSpice(item))) {
      return item.countUnit;
    }
    if (isCaseCountedPackaging(item)) return 'case';
    var number = String(item && item.itemNumber || '');
    var pieceName = defaultPieceName(item);
    if (pieceName) return pieceName;
    if (number === '800401' || number === '774477') return 'lb';
    if (number === '685406' || number === '799205' || isJarSpice(item)) return 'each';
    if (fluidCarton(item && item.pack)) return 'gal';
    if (isKosherSalt(item) || isBalsamicGlaze(item)) return 'each';
    if (isPortionPacket(item)) return 'case';
    if (canEachLb(item && item.pack)) return 'can';
    var packText = String(item && item.pack || '');
    if (namePortionLb(item) && /(\d*\.\d+|\d+)\s*lb\s*case\b/i.test(packText)) return 'each';
    return volumeCountUnit(item);
  }

  // "15 / 2 LB" is 15 pieces of 2 lb. Egg white is a carton, sour cream and tzatziki are tubs.
  function defaultPieceName(item) {
    var pack = packAmount(item && item.pack);
    if (!pack || !(pack.each > 0)) return '';
    var pieces = pack.perCase / pack.each;
    if (!(pieces > 1)) return '';
    var name = String(item && item.name || '').toLowerCase();
    var packText = String(item && item.pack || '');
    if (/evaporated/.test(name) || /#\s*\d+(?:\.\d+)?\s*can/i.test(packText) || pack.canSize) return 'can';
    if (/peanut butter/.test(name) || /\bjar\b/.test(name)) return 'jar';
    if (/egg white/.test(name) || /\bcarton\b/.test(name)) return 'carton';
    if (/sour cream|tzatziki|yogurt/.test(name) || /\btub\b/.test(name)) return 'tub';
    if (/\bcan\b/.test(name)) return 'can';
    return '';
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
    if (item && Number(item.lbPerUnit) > 0 && isPieceCountUnit(resolvedCountUnit(item))) return Number(item.lbPerUnit);
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
    if (/onion red slab|slab slice/i.test(item.name || '')) return true;
    if (/\bbrisket\b/i.test(item.name || '') && !/hash/i.test(item.name || '')) return true;
    if (/blackened|red fish|redfish/i.test(item.name || '')) return true;
    if (isBakingPantry(item) || isBalsamicGlaze(item)) return true;
    return /caramelized onion|onion caramelized/i.test(item.name || '');
  }

  // "Red Onion" inside Pickled Red Onion is the slab, not the diced onion.
  // A saved match that points at 231714 still has to order 182907.
  function forcedRecipeItemId(line) {
    var name = fold(line && line.name);
    if (name === 'red onion') return 'bek__182907';
    // The long USDA brisket line is the 70 lb meat, not a spice that happened to match the item.
    if (/beef brisket|brisket whole/.test(name)) return 'bek__500370';
    if (/blackened redfish|blackening seasoning|blackened seasoning|chef paul prudhomme/.test(name)) return 'bek__774477';
    if (/baking powder/.test(name)) return 'bek__696005';
    if (/baking soda/.test(name)) return 'bek__696131';
    if (/balsamic glaze|glaze balsamic/.test(name) && name.indexOf('vinegar') === -1) return 'bek__660356';
    return '';
  }

  function recipeOwner(line) {
    var forced = forcedRecipeItemId(line);
    if (forced) return forced;
    var pounds = Number(line && line.pounds) || 0;
    var name = fold(line && line.name);
    // A sub-pound line that is not the brisket was a bad match (the 0.2 lb garnish).
    if (line && line.catalogId === 'bek__500370' && !/brisket/.test(name) && pounds < 1) return '';
    return (line && line.catalogId) || '';
  }

  function recipeLineFor(item, lines) {
    var pounds = 0;
    var unit = 'lb';
    var eachFactor = null;
    var hit = false;
    Object.keys(lines || {}).forEach(function (key) {
      if (key === '_meta') return;
      var line = lines[key];
      if (!line) return;
      var owner = recipeOwner(line);
      if (!item || owner !== item.id) return;
      pounds += Number(line.pounds) || 0;
      unit = line.unit || unit;
      if (line.eachFactor) eachFactor = Number(line.eachFactor);
      hit = true;
    });
    if (!hit || !(pounds > 0)) return null;
    return { pounds: Math.round(pounds * 1000) / 1000, unit: unit, eachFactor: eachFactor };
  }

  function isPantryLiquid(item) {
    var name = String(item && item.name || '').toLowerCase();
    if (/bleach|sanitizer|cleaner|degreaser|detergent|soap|disinfectant|rinse aid|wash treatment/.test(name)) return false;
    return /\bhoney\b|\bsyrup\b|\boil\b|\bvinegar\b/.test(name);
  }

  // Glazes, sauces, and condiments are food even on a supply shelf. The shelf does not decide.
  // A portion packet is handed out per meal. It is a supply counted by the case, not a recipe sauce.
  function isPortionPacket(item) {
    var number = String(item && item.itemNumber || '');
    if (number === '133525' || number === '139893') return true;
    var name = String(item && item.name || '').toLowerCase();
    return /\bpc\b/.test(name) && /packet/.test(name);
  }

  function isGlazeSauceOrCondiment(item) {
    if (isPortionPacket(item)) return false;
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
    // "1 / 9-11 LB" is one piece, and the piece weighs 9 to 11 lb. Use the middle, 10 lb.
    var range = text.match(/(\d*\.\d+|\d+)\s*\/\s*(\d*\.\d+|\d+)\s*-\s*(\d*\.\d+|\d+)\s*([A-Za-z]+)/);
    if (range) {
      var low = Number(range[2]);
      var high = Number(range[3]);
      var mid = (low + high) / 2;
      var count = Number(range[1]);
      return { perCase: count * mid, each: mid, unit: canonUnit(range[4]), raw: text };
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
    // "12/16" is 12 jars of 16 oz. "12/2" is already 12 units of 2 lb, above.
    var bareOz = text.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
    if (bareOz) {
      return { perCase: Number(bareOz[1]) * Number(bareOz[2]), each: Number(bareOz[2]), unit: 'oz', raw: text };
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
    // A 64 oz or 128 oz carton is fluid ounces. 6 / 64 OZ is 3 gallons, not 384 weight ounces.
    if (from === 'oz' && isVolumeUnit(to)) from = 'floz';
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
    if (Math.abs(number) < 0.1) return String(Math.round(number * 1000) / 1000);
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
        var containerWord = countWord(item);
        result.convertedUnit = piecePack && piecePack.canSize ? 'can' : (isJarSpice(item) ? containerWord : (piecePack && piecePack.unit === 'oz' ? 'bottle' : (/egg white/i.test(String(item && item.name || '')) ? 'carton' : 'box')));
      }
    }
    return result;
  }

  function shortUnit(unit, quantity) {
    var key = canonUnit(unit);
    if (key === 'case' || key === 'cs') return 'cs';
    if (key === 'ea') return 'ea';
    var one = Math.abs(Number(quantity) - 1) < 1e-9;
    if (key === 'jar') return one ? 'jar' : 'jars';
    if (key === 'can') return one ? 'can' : 'cans';
    if (key === 'container') return one ? 'container' : 'containers';
    var label = unitLabel(unit);
    if (label === 'each') return 'ea';
    return label || '';
  }

  function needText(need) {
    if (!need) return '';
    var text = roundQty(need.quantity) + (need.unit ? ' ' + shortUnit(need.unit, need.quantity) : '');
    if (need.convertedQuantity != null && need.convertedUnit) {
      var shownUnit = need.convertedUnit;
      if (shownUnit === 'container' && Math.abs(Number(need.convertedQuantity) - 1) >= 0.05) shownUnit = 'containers';
      if (shownUnit === 'can' && Math.abs(Number(need.convertedQuantity) - 1) >= 0.05) shownUnit = 'cans';
      text += ' ≈ ' + roundApprox(need.convertedQuantity) + ' ' + shownUnit;
    }
    if (need.pieceQuantity != null && need.pieceUnit) {
      text += ' · ' + roundApprox(need.pieceQuantity) + ' × ' + roundApprox(need.pieceSize) + ' ' + need.pieceUnit;
    }
    return text;
  }

  // How many cook-list pieces are in one case. An ounce pack is that many pieces.
  // A pound case uses the portion weight in the name. A pack with no piece count returns 0.
  // "10 / 100 CT" is 1,000 pieces in a case. "20 / 50 CT" is 1,000. "10 / 250 CT" is 2,500.
  function piecesInCase(item) {
    var raw = String(item && item.pack || '');
    if (!/\bct\b/i.test(raw)) return 0;
    var pack = packAmount(raw);
    if (!pack || !(pack.perCase > 0)) return 0;
    return pack.perCase;
  }

  // Cook-list and plate-list cups and lids are counted on hand by the case.
  function isCaseCountedPackaging(item) {
    var number = String(item && item.itemNumber || '');
    if (number === '104426' || number === '104162' || number === '111634' || number === '130860') return piecesInCase(item) > 0;
    var name = String(item && item.name || '').toLowerCase();
    if (!/cup|lid/.test(name) || /baking cup|glove|hair net/.test(name)) return false;
    return /souffle|9 oz|9-12-20/.test(name) && piecesInCase(item) > 0;
  }

  function piecesPerCase(item, eachFactor) {
    if (isCaseCountedPackaging(item)) return piecesInCase(item);
    var pack = packAmount(item && item.pack);
    var edited = Number(eachFactor);
    var portion = edited > 0 ? edited : namePortionLb(item);
    if (!(edited > 0) && pack && pack.unit === 'oz' && pack.each > 0) {
      var count = pack.perCase / pack.each;
      if (count > 0) return count;
    }
    if (portion > 0 && pack && pack.unit === 'lb' && pack.perCase > 0) return pack.perCase / portion;
    if (edited > 0 && pack && pack.unit === 'oz' && pack.perCase > 0) return (pack.perCase / 16) / edited;
    if (item && Number(item.eachPerCase) > 0) return Number(item.eachPerCase);
    return 0;
  }

  function onHandAsPieces(item, onHand, eachFactor) {
    var have = onHand == null || onHand === '' ? 0 : Number(onHand) || 0;
    var unit = canonUnit(resolvedCountUnit(item));
    var pack = packAmount(item && item.pack);
    var edited = Number(eachFactor);
    var portion = edited > 0 ? edited : namePortionLb(item);
    if (!(portion > 0) && pack && pack.unit === 'oz' && pack.each > 0) portion = pack.each / 16;
    if (unit === 'lb' && portion > 0) return have / portion;
    if (unit === 'oz' && portion > 0) return have / (portion * 16);
    if (isCaseCountedPackaging(item)) return have * piecesInCase(item);
    return have;
  }

  function pieceOrder(need) {
    return !!(need && (need.source === 'cook list' || need.source === 'plate list') && canonUnit(need.unit) === 'ea');
  }

  // Cook-list and plate-list pieces order by the case when the pack says how many pieces
  // are in it. Otherwise the order stays in each, and the summary must not call that a case.
  function orderResult(item, need, onHand) {
    if (!need) return { amount: 0, unit: 'cs' };
    if (pieceOrder(need) && isPortionPacket(item)) {
      var packets = piecesPerCase(item, need.eachFactor);
      var heldCases = onHand == null || onHand === '' ? 0 : Number(onHand) || 0;
      return {
        amount: casesToOrder(Number(need.quantity) || 0, heldCases * packets, packets || 1),
        unit: 'cs'
      };
    }
    if (pieceOrder(need)) {
      var per = piecesPerCase(item, need.eachFactor);
      if (!(per > 0)) {
        var haveEach = canonUnit(resolvedCountUnit(item)) === 'ea'
          ? (onHand == null || onHand === '' ? 0 : Number(onHand) || 0)
          : 0;
        return { amount: casesToOrder(Number(need.quantity) || 0, haveEach, 1), unit: 'ea' };
      }
      return {
        amount: casesToOrder(Number(need.quantity) || 0, onHandAsPieces(item, onHand, need.eachFactor), per),
        unit: 'cs'
      };
    }
    return { amount: orderCases(item, need, onHand), unit: 'cs' };
  }

  // Need and on hand are both in the count unit. Cases round up.
  function orderCases(item, need, onHand) {
    if (!need) return 0;
    if (pieceOrder(need)) return orderResult(item, need, onHand).amount;
    var pack = packAmount(item && item.pack);
    var countUnit = resolvedCountUnit(item);
    var have = onHand == null || onHand === '' ? 0 : Number(onHand) || 0;
    if (isPieceCountUnit(countUnit) && canonUnit(need.unit) === 'lb') {
      var boxLb = pieceWeightLb(item, need.eachFactor);
      if (boxLb > 0 && pack && (pack.unit === 'lb' || pack.unit === 'oz' || !isVolumeUnit(pack.unit))) {
        var perBox = boxesPerCase(pack);
        var caseLb = pack && pack.unit === 'lb' ? pack.perCase : (pack && pack.unit === 'oz' ? pack.perCase / 16 : 0);
        if (!(pack && pack.each > 0) && caseLb > 0) perBox = caseLb / boxLb;
        return casesToOrder(Number(need.quantity) / boxLb, have, perBox);
      }
    }
    if (isPieceCountUnit(countUnit) && pack && isVolumeUnit(pack.unit) && pack.each > 0) {
      var needVol = needInCountUnit(need.quantity, need.unit, pack.unit, need.eachFactor, item && item.lbPerUnit, item);
      return casesToOrder(needVol / pack.each, have, boxesPerCase(pack));
    }
    if (canonUnit(countUnit) === 'case' && canonUnit(need.unit) === 'lb' && pack && (pack.unit === 'lb' || pack.unit === 'oz')) {
      var caseLb = pack.unit === 'lb' ? pack.perCase : pack.perCase / 16;
      if (caseLb > 0) return casesToOrder(Number(need.quantity) / caseLb, have, 1);
    }
    if (isPieceCountUnit(countUnit) && item && Number(item.eachPerCase) > 0 && canonUnit(need.unit) === 'ea') {
      return casesToOrder(Number(need.quantity) || 0, have, Number(item.eachPerCase));
    }
    var needQty = needInCountUnit(need.quantity, need.unit, countUnit, need.eachFactor, item && item.lbPerUnit, item);
    var perCase = perCaseInCountUnit(pack, countUnit);
    // Hershey 800401 is a 12 lb case. The guide text 12 / 12 OZ would weigh 9 lb.
    if (String(item && item.itemNumber || '') === '800401' && canonUnit(countUnit) === 'lb') perCase = 12;
    return casesToOrder(needQty, have, perCase || 1);
  }

  function explainQty(number) {
    var n = Number(number);
    if (!isFinite(n)) return '0';
    var hundred = Math.round(n * 100) / 100;
    if (Math.abs(hundred - Math.round(hundred)) < 1e-9) return String(Math.round(hundred));
    var tenth = Math.round(n * 10) / 10;
    if (Math.abs(hundred - tenth) < 0.011) return String(tenth);
    return String(hundred);
  }

  function countWord(item) {
    var number = String(item && item.itemNumber || '');
    var unit = canonUnit(resolvedCountUnit(item));
    if (unit === 'jar' || unit === 'can' || unit === 'carton' || unit === 'tub') return unit;
    if (number === '212500' || number === '685406') return 'jar';
    if (number === '798001') return 'can';
    if (isJarSpice(item)) return 'container';
    if (number === '393413') return 'carton';
    if (unit === 'gal') return 'gal';
    if (unit === 'lb' || unit === 'pound') return 'lb';
    if (unit === 'oz') return 'oz';
    if (unit === 'ea') return 'ea';
    return unitLabel(unit) || 'ea';
  }

  // The same subtraction the order uses, written out so a count can be checked.
  function orderExplain(item, need, onHand) {
    if (!need || !item) return '';
    var result = orderResult(item, need, onHand);
    if (pieceOrder(need) && isCaseCountedPackaging(item)) {
      var ppc = piecesInCase(item);
      var haveCases = onHand == null || onHand === '' ? 0 : Number(onHand) || 0;
      var havePieces = haveCases * ppc;
      return roundApprox(need.quantity) + ' ea need − ' + explainQty(haveCases) + ' cs × ' + explainQty(ppc)
        + ' = ' + explainQty(havePieces) + ' on hand → ' + result.amount + ' cs';
    }
    var word = countWord(item);
    var pack = packAmount(item.pack);
    var countUnit = resolvedCountUnit(item);
    var have = onHand == null || onHand === '' ? 0 : Number(onHand) || 0;
    var needQty = Number(need.quantity) || 0;
    var haveQty = have;
    var per = 1;
    var piece = 0;
    var parts = [];
    if (pieceOrder(need)) {
      per = piecesPerCase(item, need.eachFactor);
      piece = namePortionLb(item) || 0;
      if (!(per > 0)) per = 0;
      else haveQty = onHandAsPieces(item, onHand, need.eachFactor);
    } else if (isPieceCountUnit(countUnit) && pack && isVolumeUnit(pack.unit) && pack.each > 0) {
      var needVol = needInCountUnit(need.quantity, need.unit, pack.unit, need.eachFactor, item.lbPerUnit, item);
      needQty = needVol / pack.each;
      per = boxesPerCase(pack) || 1;
      parts.push(explainQty(have) + ' ' + word + ' × ' + explainQty(pack.each) + ' ' + (unitLabel(pack.unit) || pack.unit) + ' = ' + explainQty(have * pack.each) + ' ' + (unitLabel(pack.unit) || pack.unit) + ' on hand');
    } else if (isPieceCountUnit(countUnit) && canonUnit(need.unit) === 'lb') {
      piece = pieceWeightLb(item, need.eachFactor) || 0;
      if (piece > 0) {
        needQty = (Number(need.quantity) || 0) / piece;
        var perBox = boxesPerCase(pack);
        var caseLb = pack && pack.unit === 'lb' ? pack.perCase : (pack && pack.unit === 'oz' ? pack.perCase / 16 : 0);
        if (!(pack && pack.each > 0) && caseLb > 0) perBox = caseLb / piece;
        per = perBox || 1;
      }
    } else {
      needQty = needInCountUnit(need.quantity, need.unit, countUnit, need.eachFactor, item.lbPerUnit, item);
      per = perCaseInCountUnit(pack, countUnit) || 1;
      if (String(item.itemNumber || '') === '800401' && canonUnit(countUnit) === 'lb') per = 12;
    }
    var net = needQty - haveQty;
    if (!(net > 0)) net = 0;
    var orderWord = result.unit === 'ea' ? word : 'cs';
    if (piece > 0 && isPieceCountUnit(countUnit)) {
      parts.push(explainQty(have) + ' ' + word + ' × ' + explainQty(piece) + ' lb = ' + explainQty(have * piece) + ' lb on hand');
      var storedUnit = canonUnit(item.countUnit);
      if (have && (storedUnit === 'oz' || storedUnit === 'lb' || storedUnit === 'pound' || storedUnit === 'ounce')) {
        parts.push('Saved ' + explainQty(have) + ' kept as ' + word + 's, not converted from ' + (storedUnit === 'lb' || storedUnit === 'pound' ? 'lb' : 'oz'));
      }
    }
    var formula = roundApprox(needQty) + ' ' + word + ' need − ' + roundApprox(haveQty) + ' ' + word + ' on hand = ' + roundApprox(net) + ' ' + word;
    if (result.unit !== 'ea' && per > 0) formula += ' ÷ ' + explainQty(per) + ' ' + word + '/cs';
    formula += ' → ' + result.amount + ' ' + orderWord;
    parts.push(formula);
    return parts.join('. ');
  }

  // Dry spices and seasonings are food even though the temp zone says Dry.
  // The Saute Line shelf is that set. A name match covers the same kind of item on another shelf.
  function isBakingPantry(item) {
    var name = String(item && item.name || '').toLowerCase();
    if (/bleach|sanitizer|cleaner|degreaser|detergent|soap|disinfectant|rinse aid/.test(name)) return false;
    if (/\bbaking powder\b|\bbaking soda\b/.test(name)) return true;
    if (/\bextract\b|\bvanilla\b/.test(name)) return true;
    if (/\boats?\b|\boatmeal\b|\bcereal oats\b|\bflour\b|\bcornmeal\b/.test(name)) return true;
    if (/\bmarsala\b|\bwine\b|\bvinegar\b/.test(name)) return true;
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

  // Chips, jerky, shakes, bars, nuts, and juices on Front of House are resale, not recipe food.
  var RETAIL_WORD = { salt: 1, vinegar: 1, vanilla: 1, wine: 1, oil: 1, juice: 1, sugar: 1, onion: 1, pepper: 1, water: 1, cream: 1, seed: 1, seeds: 1, milk: 1, sauce: 1, extract: 1, flavor: 1 };

  function retailKind(item) {
    var section = fold(item && (item.label || item.section || ''));
    if (section.indexOf('front of house') === -1) return '';
    var name = fold(item && item.name);
    if (/\bwood chips?\b/.test(name)) return '';
    if (/\bchips?\b/.test(name)) return 'chips';
    if (/\bjerky\b/.test(name)) return 'jerky';
    if (/\bshakes?\b/.test(name)) return 'shake';
    if (/\bbars?\b/.test(name)) return 'bar';
    if (/\bnuts?\b/.test(name)) return 'nuts';
    if (/\bjuices?\b/.test(name)) return 'juice';
    return '';
  }

  function isRetailResale(item) {
    return retailKind(item) !== '';
  }

  function queryTokens(value) {
    return fold(value).split(' ').filter(function (token) { return token.length > 2; });
  }

  function wordHit(token, word) {
    if (word === token) return true;
    return token.length >= 4 && word.indexOf(token) === 0;
  }

  // A suggestion is weak when the only overlap is a generic word, or a word buried inside another word.
  // "Salt" inside "unsalted", or "vinegar" inside "Pop Chips - Salt and Vinegar".
  function weakMatchReason(query, item) {
    if (!item) return '';
    var kind = retailKind(item);
    if (kind) return 'retail Front of House ' + kind;
    var qTokens = queryTokens(query);
    var nameTokens = fold(item.name).split(' ').filter(Boolean);
    if (!qTokens.length || !nameTokens.length) return '';
    var hits = qTokens.filter(function (token) {
      return nameTokens.some(function (word) { return wordHit(token, word); });
    });
    var buried = qTokens.filter(function (token) {
      if (token.length < 3) return false;
      var name = nameTokens.join(' ');
      if (name.indexOf(token) === -1) return false;
      return !nameTokens.some(function (word) { return wordHit(token, word); });
    });
    if (!hits.length && buried.length) return 'the word ' + buried[0] + ' sits inside another word';
    if (!hits.length) return '';
    var genericHits = hits.filter(function (token) { return RETAIL_WORD[token]; });
    if (genericHits.length !== hits.length) return '';
    if (hits.indexOf(nameTokens[0]) !== -1) return '';
    var missed = qTokens.filter(function (token) { return hits.indexOf(token) === -1 && !RETAIL_WORD[token]; });
    var extras = nameTokens.filter(function (token) {
      return token.length > 2 && hits.indexOf(token) === -1 && !RETAIL_WORD[token];
    });
    if (missed.length || extras.length) return 'only the word ' + genericHits.join(' and ') + ' matches';
    return '';
  }

  function weakFoodReport(items, ingredientNames) {
    var found = [];
    var seen = {};
    function add(item, reason) {
      if (!item || !reason) return;
      if (item.orderRole === 'food' || item.orderRole === 'supply') return;
      var key = (item.itemNumber || '') + '|' + (item.name || '');
      if (seen[key]) return;
      seen[key] = true;
      found.push({ itemNumber: item.itemNumber || '', name: item.name || '', reason: reason });
    }
    (items || []).forEach(function (item) {
      if (!isRetailResale(item)) return;
      if (!isBakingPantry(item)) return;
      var words = fold(item && item.name).split(' ').filter(function (word) {
        return word === 'vinegar' || word === 'vanilla' || word === 'wine' || word === 'marsala' || word === 'extract' || word === 'oats' || word === 'flour' || word === 'cornmeal';
      });
      add(item, 'The word ' + (words.join(' and ') || 'in the name') + ' marked this retail item as food. It stays a supply with a par.');
    });
    (ingredientNames || []).forEach(function (ingredient) {
      var top = filterCatalog(ingredient, items, { solidOnly: true, allowWeak: true })[0];
      var reason = weakMatchReason(ingredient, top);
      if (reason) add(top, ingredient + ' would match because ' + reason + '.');
    });
    return found;
  }

  // Food comes from the BEK temp zone, not the shelf the item sits on.
  // Refrigeration, frozen, and retail-ready (including dry retail-ready food) are food.
  // A plain Dry zone is a supply, except dry spices and seasonings.
  // An admin Food or Supply choice wins over the zone, the spice default, and a recipe match.
  function isFoodItem(item) {
    if (!item || item.kind === 'vendor_check') return false;
    if (item.orderRole === 'food') return true;
    if (item.orderRole === 'supply') return false;
    if (isPortionPacket(item)) return false;
    if (isRetailResale(item)) return false;
    if (isBakingPantry(item)) return true;
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
      [/blackened|blackening|redfish magic|red fish magic/, /blackened|red fish|redfish/],
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
      [/marsala|wine marsala/, /marsala/],
      [/beef brisket|brisket whole/, /brisket/],
      [/^red onion$/, /onion red slab|slab slice/],
      [/diced red onion|red onion diced/, /onion red diced|red diced/]
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
    if (!item || isPortionPacket(item)) return null;
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
    if (isPortionPacket(item) && !(item && item.orderRole === 'food')) {
      if (input.cookList && Number(input.cookList.quantity) > 0) {
        return {
          quantity: Number(input.cookList.quantity) || 0,
          unit: 'each',
          eachFactor: null,
          source: 'cook list',
          reason: input.cookList.reason || ''
        };
      }
      if (input.plateList && Number(input.plateList.quantity) > 0) {
        return {
          quantity: Number(input.plateList.quantity) || 0,
          unit: 'each',
          eachFactor: null,
          source: 'plate list',
          reason: input.plateList.reason || ''
        };
      }
      var packetPar = Number(input.standingPar) || 0;
      return { quantity: packetPar, unit: 'case', eachFactor: null, source: 'standing par' };
    }
    if (item && item.orderRole === 'supply') {
      var chosenPar = Number(input.standingPar) || 0;
      var chosenUnit = input.countUnit || item.countUnit || 'each';
      if (!(chosenPar > 0)) return { quantity: 0, unit: chosenUnit, eachFactor: null, source: 'standing par' };
      return { quantity: chosenPar, unit: chosenUnit, eachFactor: null, source: 'standing par' };
    }
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
    if (isFoodItem(item) || (input.forceFood && !isRetailResale(item))) {
      var recipeQty = input.recipe ? Number(input.recipe.quantity) || 0 : 0;
      if (!(recipeQty > 0)) return { quantity: 0, unit: 'lb', eachFactor: null, source: 'recipe' };
      var plated = withVolume(item, {
        quantity: recipeQty,
        unit: (input.recipe && input.recipe.unit) || 'lb',
        eachFactor: input.recipe ? input.recipe.eachFactor : null,
        source: (input.recipe && input.recipe.source) || 'recipe',
        reason: (input.recipe && input.recipe.reason) || ''
      }, input.countUnit || (item && item.countUnit));
      return plated;
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
      // A weak name match (salt inside unsalted, vinegar inside a chip name) is not pre-selected.
      if (score && !(opts.solidOnly && score < 30)) {
        if (opts.solidOnly && !opts.allowWeak && weakMatchReason(query, item)) return;
        ranked.push({ item: item, score: score, name: item.name || '' });
      }
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
    pieceWeightLb: pieceWeightLb,
    canEachLb: canEachLb,
    defaultStandards: function () { return Object.assign({}, DEFAULT_STANDARDS); },
    standardLabels: function () { return Object.assign({}, STANDARD_LABELS); },
    useStandards: useStandards,
    standardValue: standardValue,
    weightSource: weightSource,
    orderWarning: orderWarning,
    isPantryLiquid: isPantryLiquid,
    usesSuggestedRecipe: usesSuggestedRecipe,
    forcedRecipeItemId: forcedRecipeItemId,
    recipeLineFor: recipeLineFor,
    isGlazeSauceOrCondiment: isGlazeSauceOrCondiment,
    isPortionPacket: isPortionPacket,
    packAmount: packAmount,
    perCaseInCountUnit: perCaseInCountUnit,
    shortfall: shortfall,
    casesToOrder: casesToOrder,
    needInCountUnit: needInCountUnit,
    needText: needText,
    shortUnit: shortUnit,
    isPieceCountUnit: isPieceCountUnit,
    defaultPieceName: defaultPieceName,
    shortUnit: shortUnit,
    piecesPerCase: piecesPerCase,
    piecesInCase: piecesInCase,
    isCaseCountedPackaging: isCaseCountedPackaging,
    orderResult: orderResult,
    orderExplain: orderExplain,
    orderCases: orderCases,
    isFoodItem: isFoodItem,
    isRetailResale: isRetailResale,
    weakMatchReason: weakMatchReason,
    weakFoodReport: weakFoodReport,
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
