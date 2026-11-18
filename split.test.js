const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const z = require('./split.js');

const cfg = {
  stackHeight: 6,
  leaveAtLeast: 5,
  skipList: ['Beef Taco Skillet'],
  stores: z.DEFAULT_STORES
};

function byId(row, id) {
  return row.allocations.find(item => item.id === id);
}

test('default stores are a config list and stack height is 6 for every dish', () => {
  assert.equal(z.DEFAULT_CONFIG.stackHeight, 6);
  assert.equal(z.stackSizeFor('Tex Mex Turkey Picadillo (1)', cfg), 6);
  assert.equal(z.stackSizeFor('1/2# Turkey Chorizo (1)', cfg), 6);
  assert.equal(z.stackSizeFor('1/2# Turkey Chorizo (1)', { stackHeight: 8 }), 8);
  assert.equal(z.sharesStatus(z.DEFAULT_STORES).ok, true);
  assert.equal(z.sharesStatus(z.DEFAULT_STORES).sum, 100);
  const hub = z.DEFAULT_STORES.filter(store => store.isDeliveryHub);
  assert.equal(hub.length, 1);
});

test('walk-in split rounds the first store to a stack, sums, and caps the case', () => {
  const row = z.splitDish({ dish: 'Tex Mex Turkey Picadillo (1)', plated: 100 }, cfg);
  const first = byId(row, z.DEFAULT_STORES[0].id);
  const second = byId(row, z.DEFAULT_STORES[1].id);
  assert.equal(z.allocationTotal(row), 100);
  assert.equal(first.total, 60);
  assert.equal(second.total, 40);
  assert.equal(first.caseQty, 36);
  assert.equal(first.backstock, 24);
  assert.equal(second.caseQty, 36);
  assert.equal(second.backstock, 4);
  assert.ok(first.caseQty <= first.capacity);
  assert.ok(second.caseQty <= second.capacity);
  assert.ok(row.warnings.some(w => /backstock/.test(w)));
});

test('pickups stay at their store and deliveries go to the delivery hub', () => {
  const hub = z.DEFAULT_STORES.find(store => store.isDeliveryHub);
  const other = z.DEFAULT_STORES.find(store => !store.isDeliveryHub);
  const row = z.splitDish({
    dish: 'Rustic Chicken Parmesan (2)',
    plated: 100,
    pickups: { [other.id]: 10, [hub.id]: 4 },
    delivery: 6
  }, cfg);
  const a = byId(row, other.id);
  const b = byId(row, hub.id);
  assert.equal(a.prepaid, 10);
  assert.equal(b.prepaid, 4);
  assert.equal(b.delivery, 6);
  assert.equal(row.deliveryStoreId, hub.id);
  assert.equal(z.allocationTotal(row), 100);
  assert.equal(a.walkIn, 48);
  assert.equal(b.walkIn, 32);
  assert.equal(a.total, 58);
  assert.equal(b.total, 42);
  assert.ok(a.total >= a.prepaid);
  assert.ok(b.total >= b.prepaid + b.delivery);
  assert.ok(a.caseQty <= a.capacity && b.caseQty <= b.capacity);
  assert.equal(a.caseQty + a.backstock, a.total);
});

test('a store with no uncommitted plates is not given another store\'s prepaid', () => {
  const first = z.DEFAULT_STORES[0].id;
  const row = z.splitDish({
    dish: 'Greek Chicken Bowl',
    plated: 20,
    pickups: { [first]: 20 }
  }, cfg);
  assert.equal(byId(row, first).total, 20);
  assert.equal(byId(row, z.DEFAULT_STORES[1].id).total, 0);
  assert.equal(z.allocationTotal(row), 20);
  assert.ok(row.warnings.some(w => /every store/.test(w)));
});

test('each store gets the dish when walk-in plates can move', () => {
  const stores = z.normalizeStores(z.DEFAULT_STORES).map(store => {
    store.share = store.isDeliveryHub ? 10 : 90;
    return store;
  });
  const row = z.splitDish({ dish: 'Chili Mac', plated: 18 }, { stores: stores, stackHeight: 6 });
  assert.equal(z.allocationTotal(row), 18);
  row.allocations.forEach(slot => assert.ok(slot.total >= 1, slot.name));
});

test('stack height is one setting, including half-pound dishes', () => {
  const row = z.splitDish({ dish: '1/2# Turkey Chorizo (1)', plated: 21 }, cfg);
  const first = byId(row, z.DEFAULT_STORES[0].id);
  assert.equal(row.stackSize, 6);
  assert.equal(z.allocationTotal(row), 21);
  assert.equal(first.total % 6, 0);
  row.allocations.forEach(slot => assert.ok(slot.total > 0));
});

test('a short plate still sums and does not invent a minimum stack', () => {
  const row = z.splitDish({ dish: '1/2# Baked Chicken (1)', plated: 10 }, cfg);
  assert.equal(row.stackSize, 6);
  assert.equal(z.allocationTotal(row), 10);
  assert.equal(row.warnings.some(w => /two stacks|1 stack/.test(w)), false);
});

test('door capacity comes from that store\'s door, and overflow is backstock', () => {
  const tight = z.DEFAULT_STORES[0];
  const open = z.DEFAULT_STORES[1];
  const door = tight.doors.find(item => item.id === '6');
  assert.equal(door.half, 24);
  assert.equal(open.doors.find(item => item.id === '6').half, 36);
  const plan = { '1/2# Turkey Chorizo (1)': { door: '6', share: 'half' } };
  const row = z.splitDish({ dish: '1/2# Turkey Chorizo (1)', plated: 80 }, {
    stores: z.DEFAULT_STORES,
    stackHeight: 6,
    shelfPlan: plan
  });
  const a = byId(row, tight.id);
  const b = byId(row, open.id);
  assert.equal(a.capacity, 24);
  assert.equal(b.capacity, 36);
  assert.equal(a.total, 48);
  assert.equal(a.caseQty, 24);
  assert.equal(a.backstock, 24);
  assert.equal(b.total, 32);
  assert.equal(b.caseQty, 32);
  assert.equal(b.backstock, 0);
  assert.ok(a.caseQty <= a.capacity && b.caseQty <= b.capacity);
});

test('skip list is Beef Taco Skillet only; Orange Chicken is back in stock', () => {
  assert.deepEqual(z.DEFAULT_CONFIG.skipList, ['Beef Taco Skillet']);
  assert.equal(z.isSkipped('Orange Chicken', z.DEFAULT_CONFIG.skipList), false);
  assert.equal(z.isSkipped('Beef Taco Skillet (2)', z.DEFAULT_CONFIG.skipList), true);
  const batch = z.splitBatch([
    { dish: 'Beef Taco Skillet (2)', plated: 40 },
    { dish: 'Orange Chicken', plated: 18 },
    { dish: 'Arroz Con Pollo (2)', plated: 90 }
  ], cfg);
  assert.equal(batch[0].skipped, true);
  assert.equal(z.allocationTotal(batch[0]), 0);
  assert.equal(batch[1].skipped, false);
  assert.equal(z.allocationTotal(batch[1]), 18);
  batch[1].allocations.forEach(slot => assert.ok(slot.total >= 1));
  assert.equal(z.allocationTotal(batch[2]), 90);
});

test('a week of dishes sums exactly and keeps case qty inside capacity', () => {
  const plate = [
    ['Tex Mex Turkey Picadillo (1)', 115],
    ['Bacon & Gruyere Egg Bites w/ Cauliflower Hash (2)', 51],
    ['Chicken & Italian Sausage Over Pasta (2)', 225],
    ['1/2# Baked Chicken (1)', 10],
    ['1/2# Turkey Chorizo (1)', 20],
    ['GF Chicken ZedStrips Over Mac-N-Cheese (4)', 75],
    ['Rustic Chicken Parmesan (2)', 230],
    ['Arroz Con Pollo (2)', 90],
    ['Beef Taco Skillet (2)', 12],
    ['Orange Chicken', 36]
  ];
  const results = z.splitBatch(plate.map(([dish, plated]) => ({ dish, plated })), cfg);
  results.forEach(row => {
    if (row.skipped) {
      assert.equal(row.dish.indexOf('Taco') !== -1, true);
      assert.equal(z.allocationTotal(row), 0);
      return;
    }
    assert.equal(z.allocationTotal(row), row.plated, row.dish);
    row.allocations.forEach(slot => {
      assert.ok(slot.caseQty <= slot.capacity, row.dish);
      assert.equal(slot.caseQty + slot.backstock, slot.total);
    });
    if (row.plated >= row.allocations.length) {
      const zeros = row.allocations.filter(slot => slot.total === 0);
      if (zeros.length) assert.ok(row.warnings.some(w => /every store|0%/.test(w)));
    }
  });
  const orange = results.find(row => row.dish === 'Orange Chicken');
  assert.equal(orange.skipped, false);
  assert.equal(z.allocationTotal(orange), 36);
});

test('rebalance moves half and leaves at least 5', () => {
  const a = z.DEFAULT_STORES[0].id;
  const b = z.DEFAULT_STORES[1].id;
  const before = [
    { name: '1/2# Turkey Chorizo (1)', onHand: { [a]: 25, [b]: 0 } },
    { name: '1/2# Baked Chicken (1)', onHand: { [a]: 4, [b]: 0 }, orangeStar: { [a]: 4 } },
    { name: 'Greek Chicken Bowl', onHand: { [a]: 5, [b]: 0 } },
    { name: 'Beef Taco Skillet (2)', onHand: { [a]: 20, [b]: 0 } },
    { name: 'Picadillo', onHand: { [a]: 0, [b]: 9 } }
  ];
  const snapshot = JSON.parse(JSON.stringify(before));
  const suggestions = z.rebalanceSuggestions({ dishes: before, leaveAtLeast: 5, skipList: cfg.skipList, stores: z.DEFAULT_STORES });
  assert.deepEqual(before, snapshot);

  const chorizo = suggestions.find(s => s.name.indexOf('Turkey Chorizo') !== -1 && s.reason === 'surplus');
  assert.equal(chorizo.from, a);
  assert.equal(chorizo.to, b);
  assert.equal(chorizo.qty, 12);

  const baked = suggestions.find(s => s.name.indexOf('Baked Chicken') !== -1);
  assert.equal(baked.from, a);
  assert.equal(baked.to, b);
  assert.equal(baked.reason, 'orange-star');
  assert.equal(baked.qty, 2);

  assert.equal(suggestions.find(s => s.name === 'Greek Chicken Bowl' && s.reason === 'surplus'), undefined);
  assert.equal(suggestions.find(s => s.name.indexOf('Taco') !== -1), undefined);

  const otherWay = suggestions.find(s => s.name === 'Picadillo' && s.reason === 'surplus');
  assert.equal(otherWay.from, b);
  assert.equal(otherWay.to, a);
  assert.equal(otherWay.qty, 4);
});

test('empty case with backstock suggests a pull, and overflow stays off a full case', () => {
  const a = z.DEFAULT_STORES[0].id;
  const b = z.DEFAULT_STORES[1].id;
  const suggestions = z.rebalanceSuggestions({
    dishes: [{
      name: 'Chili Mac',
      onHand: { [a]: 0, [b]: 12 },
      backstock: { [a]: 8 },
      capacity: { [a]: 4, [b]: 36 }
    }],
    leaveAtLeast: 5,
    skipList: [],
    stores: z.DEFAULT_STORES
  });
  const pull = suggestions.find(s => s.reason === 'backstock');
  const move = suggestions.find(s => s.reason === 'surplus');
  const overflow = suggestions.find(s => s.reason === 'overflow');
  assert.equal(pull.from, z.backstockLocationId(a));
  assert.equal(pull.to, a);
  assert.equal(pull.qty, 4);
  assert.equal(move.from, b);
  assert.equal(move.to, a);
  assert.equal(move.qty, 4);
  assert.equal(overflow.to, z.backstockLocationId(a));
  assert.equal(overflow.qty, 2);
});

test('share shift moves one stack toward the out and away from orange star', () => {
  const a = z.DEFAULT_STORES[0].id;
  const b = z.DEFAULT_STORES[1].id;
  const proposals = z.proposeShareShifts({
    stores: z.DEFAULT_STORES,
    stackHeight: 6,
    skipList: cfg.skipList,
    dishes: [
      { name: '1/2# Turkey Chorizo (1)', plated: 20 },
      { name: 'Rustic Chicken Parmesan (2)', plated: 230 },
      { name: 'Orange Chicken', plated: 40 }
    ],
    stockouts: [
      { name: '1/2# Turkey Chorizo (1)', store: b },
      { name: 'Rustic Chicken Parmesan (2)', store: a }
    ],
    orangeStar: [
      { name: '1/2# Turkey Chorizo (1)', store: a, qty: 25 },
      { name: 'Rustic Chicken Parmesan (2)', store: b, qty: 16 }
    ]
  });
  const chorizo = proposals.find(p => p.dish.indexOf('Turkey Chorizo') !== -1);
  assert.equal(chorizo.direction, b);
  assert.ok(chorizo.nextShares[b] > chorizo.currentShares[b]);
  assert.equal(Math.round(chorizo.currentShares[a] - chorizo.nextShares[a]), 30);

  const rustic = proposals.find(p => p.dish.indexOf('Rustic') !== -1);
  assert.equal(rustic.direction, a);
  assert.ok(rustic.nextShares[a] > rustic.currentShares[a]);
  const sum = Object.values(rustic.nextShares).reduce((total, n) => total + n, 0);
  assert.ok(Math.abs(sum - 100) < 0.001);

  assert.equal(proposals.find(p => p.dish === 'Orange Chicken'), undefined);
});

test('conflicting out and orange-star signals are not applied', () => {
  const b = z.DEFAULT_STORES[1].id;
  const proposals = z.proposeShareShifts({
    stores: z.DEFAULT_STORES,
    stackHeight: 6,
    dishes: [{ name: 'Mahi', plated: 100 }],
    stockouts: [{ name: 'Mahi', store: b }],
    orangeStar: [{ name: 'Mahi', store: b, qty: 9 }]
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].direction, 'none');
  assert.deepEqual(proposals[0].nextShares, proposals[0].currentShares);
});

test('oldest use-by moves first, including across the new year', () => {
  const plan = z.allocateOldestFirst([
    { useBy: '1-4', qty: 5 },
    { useBy: '12-28', qty: 3 },
    { useBy: '1-8', qty: 4 }
  ], 6, '2026-12-20');
  assert.deepEqual(plan.moves.map(m => [m.useBy, m.qty]), [
    ['12-28', 3],
    ['1-4', 3]
  ]);
  assert.equal(plan.moved, 6);
  assert.equal(plan.shortfall, 0);

  const short = z.allocateOldestFirst([{ useBy: '10-18', qty: 2 }], 5, '2026-10-13');
  assert.equal(short.moved, 2);
  assert.equal(short.shortfall, 3);
});

test('use-by keys pick the year inside the shelf-life window', () => {
  assert.equal(z.useByKeyToIso('12-28', '2026-12-20'), '2026-12-28');
  assert.equal(z.useByKeyToIso('1-4', '2026-12-20'), '2027-01-04');
  assert.equal(z.useByKeyToIso('12-28', '2027-01-02'), '2026-12-28');
  assert.equal(z.addDaysIso('2026-10-12', 18), '2026-10-30');
  assert.equal(z.isoToUseByKey('2026-10-30'), '10-30');
});

test('prepaid CSV follows store names from the config, deliveries stay a hub total', () => {
  const first = z.DEFAULT_STORES[0];
  const hub = z.DEFAULT_STORES.find(store => store.isDeliveryHub);
  const parsed = z.parsePrepaidCsv([
    'dish,store,qty,type',
    'Tex Mex Turkey Picadillo (1),' + first.name + ',4,pickup',
    'Tex Mex Turkey Picadillo (1),' + hub.name + ',6,pickup',
    '"Arroz Con Pollo (2)",' + first.name + ',3,delivery',
    'Greek Chicken Bowl,' + hub.id + ',2'
  ].join('\n'), z.DEFAULT_STORES);
  const totals = z.aggregateOrders(parsed);
  const pic = totals.find(r => r.dish.indexOf('Picadillo') !== -1);
  assert.equal(pic.pickups[first.id], 4);
  assert.equal(pic.pickups[hub.id], 6);
  const arroz = totals.find(r => r.dish.indexOf('Arroz') !== -1);
  assert.equal(arroz.delivery, 3);
  assert.equal(arroz.pickups[first.id], undefined);
  const greek = totals.find(r => r.dish.indexOf('Greek') !== -1);
  assert.equal(greek.pickups[hub.id], 2);
});

test('Shopify SKU CSV maps a scanned UPC, and a manual link is only the fallback', () => {
  const csv = [
    'Handle,Title,Variant SKU,Variant Barcode',
    'picadillo,Tex Mex Turkey Picadillo (1),012345678905,012345678905',
    'orange,Orange Chicken,999111,999111'
  ].join('\n');
  const rows = z.parseSkuCsv(csv);
  assert.equal(rows[0].dish, 'Tex Mex Turkey Picadillo (1)');
  const skuMap = z.skuMapFromRows(rows);
  const manual = { '555': { dishName: 'Greek Chicken Bowl' } };
  assert.equal(z.lookupBarcode('012345678905', manual, skuMap).dish, 'Tex Mex Turkey Picadillo (1)');
  assert.equal(z.lookupBarcode('12345678905', manual, skuMap).dish, 'Tex Mex Turkey Picadillo (1)');
  assert.equal(z.lookupBarcode('555', manual, skuMap).dish, 'Greek Chicken Bowl');
  assert.equal(z.lookupBarcode('000', manual, skuMap), null);
});

test('plated import uses finalCount and falls back to ordered, without double-counting a carry', () => {
  const data = {
    'Tuesday 10-13': {
      'Station 1': { dishes: [
        { name: 'Picadillo', ordered: 100, finalCount: '112' },
        { name: 'Mahi', ordered: 150, finalCount: '' },
        { name: 'Chili Mac', ordered: 80, finalCount: '40', carriedTo: 'Wednesday 10-14', fullOrdered: 80 }
      ]}
    },
    'Wednesday 10-14': {
      'Station 2': { dishes: [
        { name: 'Chili Mac', ordered: 40, finalCount: '40' }
      ]}
    }
  };
  const rows = z.platedFromProduction(data, ['Tuesday 10-13', 'Wednesday 10-14']);
  const by = Object.fromEntries(rows.map(r => [r.dish, r]));
  assert.equal(by.Picadillo.plated, 112);
  assert.equal(by.Mahi.plated, 150);
  assert.equal(by.Mahi.fromOrdered, 150);
  assert.equal(by['Chili Mac'].plated, 80);
});

test('the inventory page does not hardcode store names', () => {
  ['inventory.html', 'inventory-features.js', 'inventory-remote.js', 'firebase-config.js', 'inventory-store.js'].forEach(file => {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.equal(/\bcolonnade\b/i.test(text), false, file);
    assert.equal(/\brim\b/i.test(text), false, file);
  });
});

test('store names are config data, not branches in the split logic', () => {
  const src = fs.readFileSync(path.join(__dirname, 'split.js'), 'utf8');
  const start = src.indexOf('var DEFAULT_STORES');
  const end = src.indexOf('var DEFAULT_CONFIG');
  assert.ok(start >= 0 && end > start);
  const logic = src.slice(0, start) + src.slice(end);
  assert.equal(/\bcolonnade\b/i.test(logic), false);
  assert.equal(/\brim\b/i.test(logic), false);
});
