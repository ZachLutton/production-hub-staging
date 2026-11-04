// Colonnade cook list. Each line is a component with a weight and an (ea) or (lbs) count.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedCook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var CUP = {
    souffle_1_5: { id: 'souffle_1_5', label: '1.5 oz cup + 2 oz lid', cupNumber: '111634', cupName: 'Cup Plas Souffle 1.5 Oz Trans', lidNumber: '130860', lidName: 'Lid Plas Souffle 2 Oz' },
    cup_9oz: { id: 'cup_9oz', label: '9 oz cup + lid', cupNumber: '104162', cupName: 'Cup Plas 9 Oz Squat Clear', lidNumber: '104426', lidName: 'Lid Plas 9-12-20 Oz No Slot' }
  };
  // Purchase items. Cooked portions of the same protein are not a second order.
  var ITEM_RULES = [
    [/4\s*oz\s+raw\s+chicken\s+breast/i, '211262', 'Chicken Breast 4 Oz Blsl Fresh'],
    [/4\s*oz\s+raw\s+mahi/i, '202105', 'Mahi Mahi Portion 4oz Ivp'],
    [/3\s*oz\s+omelette|zedric'?s\s+3\s*oz\s+omelette/i, '393795', 'Egg Omelette W/cheddar Chs'],
    [/grilled\s+salmon/i, 'local_salmon_4oz', '4 oz salmon filets'],
    [/^beef\s+patty$/i, '185095', 'Beef Patty 4/1 90/10 Wide'],
    [/^chicken\s+thigh$/i, '121792', 'Chicken Thigh Blsl Raw'],
    [/marinated\s+cod\s+filet/i, '555070', 'Cod Loin 4 oz Skinless Pacific'],
    [/breakfast\s+sausage\s+patty/i, '492773', 'Turkey Sausage Patty Cooked'],
    [/sauced\s+meatball\s+1\s*oz/i, '522402', 'Meatball Italian 1 Oz Cooked'],
    [/cauliflower\s+hash/i, '172359', 'Cauliflower hashbrown']
  ];

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function nameKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
  }

  function itemNumberKey(value) {
    return String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  }

  function parseCookList(text) {
    var raw = String(text || '').replace(/\f/g, '\n');
    var cookDate = '';
    var cookMatch = raw.match(/Cook List for\s+[A-Za-z]+\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i);
    if (cookMatch) {
      var month = MONTHS[cookMatch[1].toLowerCase()];
      if (month) cookDate = cookMatch[3] + '-' + pad(month) + '-' + pad(cookMatch[2]);
    }
    var components = [];
    var seen = {};
    var pending = '';
    function add(name, quantity, unit) {
      if (!name || !(quantity > 0)) return;
      var key = nameKey(name);
      if (!seen[key]) {
        seen[key] = { key: key, name: name, quantity: 0, unit: unit };
        components.push(seen[key]);
      }
      seen[key].quantity += quantity;
    }
    raw.split(/\n/).forEach(function (line) {
      var trimmed = String(line || '').trim();
      var match = trimmed.match(/^(.+?)\s+([\d,.]+)\s*\((ea|lbs)\)\s*$/i);
      if (match) {
        pending = '';
        add(match[1].trim(), Number(String(match[2]).replace(/,/g, '')), /^lb/i.test(match[3]) ? 'lb' : 'ea');
        return;
      }
      var alone = trimmed.match(/^([\d,.]+)\s*\((ea|lbs)\)\s*$/i);
      if (alone && pending) {
        add(pending, Number(String(alone[1]).replace(/,/g, '')), /^lb/i.test(alone[2]) ? 'lb' : 'ea');
        pending = '';
        return;
      }
      if (/[A-Za-z]/.test(trimmed) && !/Cook List for|Generated on|Component\b|Weight\b|Quantity\b|-- \d+ of /i.test(trimmed)) pending = trimmed;
      else pending = '';
    });
    return { cookDate: cookDate, components: components };
  }

  function defaultCupSize(name) {
    var text = String(name || '').trim();
    if (/muffin|chew/i.test(text)) return 'cup_9oz';
    if (/cup$/i.test(text) || /crema portion$/i.test(text)) return 'souffle_1_5';
    return '';
  }

  function defaultItem(name) {
    var text = String(name || '');
    for (var i = 0; i < ITEM_RULES.length; i++) {
      if (ITEM_RULES[i][0].test(text)) return { itemNumber: ITEM_RULES[i][1], catalogName: ITEM_RULES[i][2] };
    }
    return { itemNumber: '', catalogName: '' };
  }

  function specFor(component, saved) {
    var baseCup = defaultCupSize(component && component.name);
    var baseItem = defaultItem(component && component.name);
    var over = saved && component && saved[component.key];
    var cupSize = baseCup;
    var itemNumber = baseItem.itemNumber;
    var catalogName = baseItem.catalogName;
    if (over && Object.prototype.hasOwnProperty.call(over, 'cupSize')) cupSize = String(over.cupSize || '');
    if (over && over.itemNumber != null && String(over.itemNumber) !== '') {
      itemNumber = String(over.itemNumber);
      catalogName = over.catalogName || catalogName;
    }
    if (over && over.itemNumber === '') itemNumber = '';
    return { cupSize: cupSize, itemNumber: itemNumber, catalogName: catalogName };
  }

  function supplyTotals(components, saved) {
    var souffleCups = 0;
    var souffleLids = 0;
    var nineCups = 0;
    var nineLids = 0;
    var rows = [];
    (components || []).forEach(function (row) {
      if (!row || row.unit !== 'ea') return;
      var spec = specFor(row, saved);
      var count = Number(row.quantity) || 0;
      var cups = 0;
      var lids = 0;
      if (spec.cupSize === 'souffle_1_5') {
        cups = count;
        lids = count;
        souffleCups += count;
        souffleLids += count;
      } else if (spec.cupSize === 'cup_9oz') {
        cups = count;
        lids = count;
        nineCups += count;
        nineLids += count;
      }
      rows.push({ key: row.key, name: row.name, quantity: count, cupSize: spec.cupSize, itemNumber: spec.itemNumber, catalogName: spec.catalogName, cups: cups, lids: lids });
    });
    return { souffleCups: souffleCups, souffleLids: souffleLids, nineCups: nineCups, nineLids: nineLids, rows: rows };
  }

  function piecesForItem(item, components, saved) {
    if (!item) return null;
    var number = itemNumberKey(item.itemNumber);
    var internal = String(item.internalKey || '');
    var total = 0;
    var hit = false;
    var reasons = [];
    (components || []).forEach(function (row) {
      if (!row || row.unit !== 'ea') return;
      var spec = specFor(row, saved);
      var count = Number(row.quantity) || 0;
      var cup = CUP[spec.cupSize];
      if (cup && (number === cup.cupNumber || number === cup.lidNumber)) {
        total += count;
        hit = true;
        reasons.push(count + ' ' + row.name);
      }
      var rawId = String(spec.itemNumber || '');
      var mapped = itemNumberKey(rawId);
      if (rawId && (rawId === internal || rawId === String(item.itemNumber || '') || (mapped && mapped === number))) {
        total += count;
        hit = true;
        reasons.push(count + ' ' + row.name);
      }
    });
    if (!hit) return null;
    return { quantity: total, reasons: reasons };
  }

  return {
    CUP: CUP,
    parseCookList: parseCookList,
    nameKey: nameKey,
    defaultCupSize: defaultCupSize,
    defaultItem: defaultItem,
    specFor: specFor,
    supplyTotals: supplyTotals,
    piecesForItem: piecesForItem
  };
});
