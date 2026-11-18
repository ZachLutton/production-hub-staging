// Month-end prices change only when an approval record exists for that month.
// No record: the price already on the row is left alone.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedPrice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function approvedPrice(itemNumber, fallback, approval) {
    if (!approval || !approval.prices) return fallback;
    var key = String(itemNumber || '').trim();
    if (!key || !Object.prototype.hasOwnProperty.call(approval.prices, key)) return fallback;
    var next = Number(approval.prices[key]);
    return isFinite(next) ? next : fallback;
  }

  function lineAmount(price, qty) {
    return (Number(price) || 0) * (Number(qty) || 0);
  }

  // Same rule as the monthly page: hidden rows still contribute a saved count.
  function monthTotal(lines, approval) {
    return (lines || []).reduce(function (sum, line) {
      var price = approvedPrice(line.itemNumber, line.price, approval);
      return sum + lineAmount(price, line.qty);
    }, 0);
  }

  return {
    approvedPrice: approvedPrice,
    lineAmount: lineAmount,
    monthTotal: monthTotal
  };
});
