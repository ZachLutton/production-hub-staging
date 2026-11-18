// Plating garnishes. A finished plate can add a purchased item by the ounce.
// Those ounces are not in the scaled cook recipes, so the cook PDF never orders them.
// Portion × the week's plate count is the need, in pounds.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedGarnish = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Recipal plate card 59_REGULAR, Seared Beef Tenderloin.
  // Balsamic glaze is 0.25 oz on the plate. The beef, mushrooms, and potatoes
  // are cooked recipes and already come from the scaled recipe.
  var LIBRARY = [
    {
      dish: /seared beef tenderloin/i,
      lines: [{ name: 'Balsamic Glaze', itemNumber: '660356', ounces: 0.25 }]
    }
  ];

  function round3(number) {
    return Math.round((Number(number) || 0) * 1000) / 1000;
  }

  function dishList(dishes) {
    if (!dishes) return [];
    if (Array.isArray(dishes)) return dishes;
    return Object.keys(dishes).map(function (key) {
      var row = dishes[key] || {};
      return { name: row.name || key, count: Number(row.count) || Number(row.quantity) || 0 };
    });
  }

  // A Recipal assembly card: a recipe name, then Ingredient / Quantity / Unit rows.
  // Ounce rows are per plate. Cooked subrecipes are not garnishes; a purchased
  // item passed in `purchased` (item numbers or names) is.
  function parseAssembly(text, purchased) {
    var lines = String(text || '').split(/\n/);
    var cards = [];
    var current = null;
    function bought(name) {
      var folded = String(name || '').toLowerCase();
      return (purchased || []).some(function (item) {
        if (item && item.itemNumber && String(item.itemNumber) === String(name)) return true;
        var itemName = String(item && item.name || item || '').toLowerCase();
        return itemName && (folded === itemName || folded.indexOf(itemName) !== -1 || itemName.indexOf(folded) !== -1);
      });
    }
    lines.forEach(function (raw) {
      var line = String(raw || '').trim();
      var title = line.match(/^Recipe Name\s*,\s*SKU/i);
      if (title) { current = null; return; }
      if (!current && line && !/^ingredient\b/i.test(line) && !/^-+$/.test(line) && line.indexOf(',') === -1) {
        current = { name: line, lines: [] };
        cards.push(current);
        return;
      }
      var named = line.match(/^([^,]+),\s*([0-9.]+)\s*,\s*([A-Za-z]+)/);
      if (current && named && !/^ingredient$/i.test(named[1].trim()) && !/^net weight/i.test(named[1].trim())) {
        var unit = named[3].toLowerCase();
        var row = { name: named[1].trim(), quantity: Number(named[2]) || 0, unit: unit };
        if (unit === 'oz' && bought(row.name)) current.lines.push(row);
      }
    });
    return cards.filter(function (card) { return card.lines.length; });
  }

  function forItem(item, dishes) {
    var number = String(item && (item.itemNumber || '') || '');
    var ounces = 0;
    var reasons = [];
    dishList(dishes).forEach(function (dish) {
      var count = Number(dish.count) || 0;
      if (!(count > 0)) return;
      LIBRARY.forEach(function (plate) {
        if (!plate.dish.test(String(dish.name || ''))) return;
        plate.lines.forEach(function (line) {
          if (number && line.itemNumber !== number) return;
          if (!number && String(item && item.name || '').toLowerCase().indexOf(line.name.toLowerCase()) === -1) return;
          ounces += line.ounces * count;
          reasons.push(count + ' ' + dish.name + ' × ' + line.ounces + ' oz ' + line.name);
        });
      });
    });
    if (!(ounces > 0)) return null;
    return { pounds: round3(ounces / 16), ounces: round3(ounces), unit: 'lb', reason: reasons.join('; ') };
  }

  return {
    LIBRARY: LIBRARY,
    parseAssembly: parseAssembly,
    forItem: forItem
  };
});
