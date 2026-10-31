// Supplies bought per meal, not from the BEK guide. Add a row here for lids or labels later.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedMeals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var SUPPLIES = [
    { id: 'meal_container', name: 'Meal containers', perMeal: 1, caseSize: 552, unit: 'each', orderBy: 'pallet' }
  ];

  function orderMath() {
    if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
      try { return require('./order-math.js'); } catch (e) { /* browser */ }
    }
    return typeof globalThis !== 'undefined' ? globalThis.ZedOrder : null;
  }

  function list() {
    return SUPPLIES.map(function (row) {
      return {
        id: row.id,
        name: row.name,
        perMeal: row.perMeal,
        caseSize: row.caseSize,
        unit: row.unit,
        orderBy: row.orderBy
      };
    });
  }

  function lineFor(supply, totalCook, onHand) {
    var meals = Number(totalCook) || 0;
    var need = meals * (Number(supply.perMeal) || 0);
    var have = onHand == null || onHand === '' ? 0 : Number(onHand) || 0;
    var cases = orderMath().casesToOrder(need, have, supply.caseSize);
    return {
      id: supply.id,
      name: supply.name,
      perMeal: supply.perMeal,
      caseSize: supply.caseSize,
      unit: supply.unit || 'each',
      orderBy: supply.orderBy || 'pallet',
      need: need,
      onHand: onHand == null || onHand === '' ? null : have,
      cases: cases,
      pallet: cases > 0
    };
  }

  return { list: list, lineFor: lineFor };
});
