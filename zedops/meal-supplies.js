// Packaging for a plate list. Meal trays are the default. Muffins, cookies, and chews
// take a 9 oz cup and a matching lid instead. Case sizes for the cup and lid come from
// the BEK catalog pack (20/50 CT and 10/100 CT). Trays stay 552 and are not a BEK item.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedMeals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var TYPES = {
    meal_container: {
      id: 'meal_container',
      name: 'Meal containers',
      caseSize: 552,
      unit: 'each',
      orderBy: 'pallet',
      catalogNumber: '',
      catalogName: '',
      pack: '',
      needKey: 'containers'
    },
    cup_9oz: {
      id: 'cup_9oz',
      name: '9 oz cups',
      caseSize: 1000,
      unit: 'each',
      orderBy: 'case',
      catalogNumber: '104162',
      catalogName: 'Cup Plas 9 Oz Squat Clear',
      pack: '20 / 50 CT',
      needKey: 'cup'
    },
    lid_9oz: {
      id: 'lid_9oz',
      name: '9 oz lids',
      caseSize: 1000,
      unit: 'each',
      orderBy: 'case',
      catalogNumber: '104426',
      catalogName: 'Lid Plas 9-12-20 Oz No Slot',
      pack: '10 / 100 CT',
      needKey: 'cup'
    }
  };

  function orderMath() {
    if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
      try { return require('./order-math.js'); } catch (e) { /* browser */ }
    }
    return typeof globalThis !== 'undefined' ? globalThis.ZedOrder : null;
  }

  // A 9 oz cup holds 3 cookies or 3 chews. A muffin takes the whole cup.
  var PIECES_PER_CUP = { cookie: 3, chew: 3, muffin: 1 };

  function componentFor(name) {
    var text = String(name || '');
    if (/muffin/i.test(text)) return 'muffin';
    if (/chew/i.test(text)) return 'chew';
    if (/cookie/i.test(text)) return 'cookie';
    return '';
  }

  function piecesPerCup(component, saved) {
    var custom = saved && Number(saved[component]);
    if (custom > 0) return custom;
    return PIECES_PER_CUP[component] || 1;
  }

  function cupsForCount(count, per) {
    var pieces = Number(count) || 0;
    if (!(pieces > 0)) return 0;
    var size = Number(per);
    if (!(size > 0)) size = 1;
    return Math.ceil(pieces / size - 1e-9);
  }

  function packForDish(name, savedPackId) {
    if (savedPackId === 'meal_container' || savedPackId === 'cup_9oz') return savedPackId;
    if (/muffin|cookie|chew/i.test(String(name || ''))) return 'cup_9oz';
    return 'meal_container';
  }

  function packLabel(packId) {
    return packId === 'cup_9oz' ? '9 oz cup and lid' : 'Meal container';
  }

  // Built-in plate links. An admin save for that item replaces these.
  function defaultPlateItems(item, dishes) {
    var number = String(item && item.itemNumber || '').replace(/^0+/, '');
    var rows = [];
    (dishes || []).forEach(function (dish) {
      if (!dish || !dish.key) return;
      if (number === '393795' && /omelet/i.test(dish.name || '')) {
        rows.push({ key: dish.key, name: dish.name || '', count: Number(dish.count) || 0, qty: 1 });
      }
      if (/greek chicken bowl/i.test(dish.name || '') && (number === '111634' || number === '130860')) {
        rows.push({ key: dish.key, name: dish.name || '', count: Number(dish.count) || 0, qty: 2 });
      }
    });
    return rows;
  }

  function plateItemRows(item, dishes, saved) {
    if (saved && typeof saved === 'object') {
      var rows = [];
      Object.keys(saved).forEach(function (key) {
        var spec = saved[key];
        if (!spec) return;
        var qty = Number(spec.qty);
        if (!(qty > 0)) return;
        var dish = null;
        (dishes || []).forEach(function (row) { if (row && row.key === key) dish = row; });
        rows.push({
          key: key,
          name: (dish && dish.name) || spec.name || key,
          count: dish ? (Number(dish.count) || 0) : 0,
          qty: qty
        });
      });
      return rows;
    }
    return defaultPlateItems(item, dishes);
  }

  function plateItemPieces(item, dishes, saved) {
    var rows = plateItemRows(item, dishes, saved);
    if (!rows.length) return null;
    var pieces = 0;
    rows.forEach(function (row) { pieces += row.count * row.qty; });
    return pieces;
  }

  function tally(dishes, choices, totalCook, pieces) {
    var cup = 0;
    var cupPieces = 0;
    var rows = [];
    (dishes || []).forEach(function (dish) {
      if (!dish) return;
      var count = Number(dish.count) || 0;
      var saved = choices && dish.key ? choices[dish.key] : null;
      var savedId = saved && (saved.packId || saved);
      var packId = packForDish(dish.name, typeof savedId === 'string' ? savedId : '');
      var component = packId === 'cup_9oz' ? componentFor(dish.name) : '';
      var perCup = component ? piecesPerCup(component, pieces) : 0;
      var cups = component ? cupsForCount(count, perCup) : 0;
      if (packId === 'cup_9oz') {
        cup += cups;
        cupPieces += count;
      }
      rows.push({ key: dish.key, name: dish.name, count: count, packId: packId, component: component, perCup: perCup, cups: cups });
    });
    var total = Number(totalCook);
    if (!(total >= 0)) {
      total = rows.reduce(function (sum, row) { return sum + row.count; }, 0);
    }
    return { dishes: rows, totalCook: total, cup: cup, cupPieces: cupPieces, containers: Math.max(0, total - cupPieces) };
  }

  function typeOf(id) {
    return TYPES[id] || null;
  }

  function itemNumberKey(value) {
    return String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  }

  // A packaging type with a BEK item number is ordered from BEK. One without stays an on-hand check.
  function typeForItemNumber(itemNumber) {
    var key = itemNumberKey(itemNumber);
    if (!key) return null;
    var found = null;
    Object.keys(TYPES).forEach(function (id) {
      var type = TYPES[id];
      if (type.catalogNumber && itemNumberKey(type.catalogNumber) === key) found = type;
    });
    return found;
  }

  function unitsFor(type, summary) {
    if (!type || !summary) return 0;
    if (type.needKey === 'containers') return summary.containers;
    if (type.needKey === 'cup') return summary.cup;
    return 0;
  }

  // Why a cup or lid row is zero. A matched plate list returns an empty reason.
  function cupNeedReason(plate, summary) {
    if (!plate) return 'No plate list is approved for this cook date, so this need is 0.';
    if (!summary || !summary.dishes || !summary.dishes.length) {
      return 'The plate list has no dish lines, so muffin and cookie names were not matched.';
    }
    if (!(summary.cup > 0)) return 'No dish on the plate list matched muffin, cookie, or chew, so this need is 0.';
    return '';
  }

  function orderLine(typeId, needUnits, onHand, caseSize) {
    var base = TYPES[typeId];
    if (!base) return null;
    var size = Number(caseSize) > 0 ? Number(caseSize) : base.caseSize;
    var need = Number(needUnits) || 0;
    var have = onHand == null || onHand === '' ? 0 : Number(onHand) || 0;
    var cases = orderMath().casesToOrder(need, have, size);
    return {
      id: base.id,
      name: base.name,
      caseSize: size,
      defaultCaseSize: base.caseSize,
      unit: base.unit,
      orderBy: base.orderBy,
      catalogNumber: base.catalogNumber,
      catalogName: base.catalogName,
      pack: base.pack,
      onBekOrder: !!base.catalogNumber,
      need: need,
      onHand: onHand == null || onHand === '' ? null : have,
      cases: cases,
      orderNeeded: cases > 0
    };
  }

  function linesFor(summary, onHandById, caseSizes) {
    var hands = onHandById || {};
    var sizes = caseSizes || {};
    return [
      orderLine('meal_container', summary.containers, hands.meal_container, sizes.meal_container),
      orderLine('cup_9oz', summary.cup, hands.cup_9oz, sizes.cup_9oz),
      orderLine('lid_9oz', summary.cup, hands.lid_9oz, sizes.lid_9oz)
    ];
  }

  return {
    PIECES_PER_CUP: PIECES_PER_CUP,
    componentFor: componentFor,
    piecesPerCup: piecesPerCup,
    cupsForCount: cupsForCount,
    packForDish: packForDish,
    defaultPlateItems: defaultPlateItems,
    plateItemRows: plateItemRows,
    plateItemPieces: plateItemPieces,
    packLabel: packLabel,
    tally: tally,
    typeOf: typeOf,
    typeForItemNumber: typeForItemNumber,
    unitsFor: unitsFor,
    cupNeedReason: cupNeedReason,
    orderLine: orderLine,
    linesFor: linesFor
  };
});
