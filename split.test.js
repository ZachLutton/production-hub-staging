const test = require('node:test');
const assert = require('node:assert/strict');
const z = require('./split.js');

const cfg = {
  colonnadeShare: 0.6,
  stackRegular: 6,
  stackSmall: 7,
  smallMatchers: ['1/2#'],
  leaveAtLeast: 5,
  skipList: ['Beef Taco Skillet']
};

test('default share is 60/40 and stacks are 6 regular / 7 small', () => {
  assert.equal(z.DEFAULT_CONFIG.colonnadeShare, 0.6);
  assert.equal(z.stackSizeFor('Tex Mex Turkey Picadillo (1)', cfg), 6);
  assert.equal(z.stackSizeFor('1/2# Turkey Chorizo (1)', cfg), 7);
  assert.equal(z.asShare(60, 0.5), 0.6);
});

test('walk-in split rounds colonnade to a stack and still sums to plated', () => {
  const row = z.splitDish({ dish: 'Tex Mex Turkey Picadillo (1)', plated: 100 }, cfg);
  assert.equal(row.colonnade + row.rim, 100);
  assert.equal(row.colonnade, 60);
  assert.equal(row.rim, 40);
  assert.ok(row.colonnade >= 6 && row.rim >= 6);
  assert.equal(row.warnings.length, 0);
});

test('prepaid pickups stay at their store and deliveries go to the Rim', () => {
  const row = z.splitDish({
    dish: 'Rustic Chicken Parmesan (2)',
    plated: 100,
    prepaidColonnade: 10,
    prepaidRim: 4,
    delivery: 6
  }, cfg);
  assert.equal(row.prepaidColonnade, 10);
  assert.equal(row.prepaidRim, 4);
  assert.equal(row.delivery, 6);
  assert.equal(row.colonnade + row.rim, 100);
  // Rest is 80. 60% of 80 is 48, already a stack. Rim walk-in is 32, plus 4 pickup + 6 delivery.
  assert.equal(row.walkInColonnade, 48);
  assert.equal(row.walkInRim, 32);
  assert.equal(row.colonnade, 58);
  assert.equal(row.rim, 42);
  assert.ok(row.colonnade >= row.prepaidColonnade);
  assert.ok(row.rim >= row.prepaidRim + row.delivery);
});

test('minimum stack is not stolen from the other store\'s prepaid', () => {
  const row = z.splitDish({
    dish: 'Greek Chicken Bowl',
    plated: 20,
    prepaidColonnade: 20
  }, cfg);
  assert.equal(row.colonnade, 20);
  assert.equal(row.rim, 0);
  assert.equal(row.colonnade + row.rim, 20);
  assert.ok(row.warnings.some(w => /1 stack/.test(w)));
});

test('each store gets a stack when there are enough uncommitted plates', () => {
  const row = z.splitDish({ dish: 'Chili Mac', plated: 18, colonnadeShare: 0.9 }, cfg);
  assert.equal(row.colonnade + row.rim, 18);
  assert.ok(row.colonnade >= 6);
  assert.ok(row.rim >= 6);
});

test('small stack of 7 is used for half-pound proteins', () => {
  const row = z.splitDish({ dish: '1/2# Turkey Chorizo (1)', plated: 21 }, cfg);
  assert.equal(row.stackSize, 7);
  assert.equal(row.colonnade + row.rim, 21);
  assert.ok(row.colonnade >= 7 && row.rim >= 7);
  assert.equal(row.colonnade % 7, 0);
});

test('plated below two stacks is not forced and still sums', () => {
  const row = z.splitDish({ dish: '1/2# Baked Chicken (1)', plated: 10 }, cfg);
  assert.equal(row.stackSize, 7);
  assert.equal(row.colonnade + row.rim, 10);
  assert.ok(row.warnings.some(w => /below two stacks/.test(w)));
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
  assert.equal(batch[0].colonnade, 0);
  const orange = batch[1];
  assert.equal(orange.skipped, false);
  assert.equal(orange.colonnade + orange.rim, 18);
  assert.ok(orange.colonnade >= 6 && orange.rim >= 6);
  assert.equal(batch[2].skipped, false);
  assert.equal(batch[2].colonnade + batch[2].rim, 90);
  assert.ok(batch[2].colonnade >= 6 && batch[2].rim >= 6);
});

test('a week of dishes sums exactly and keeps a stack when plated allows it', () => {
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
      assert.equal(row.colonnade + row.rim, 0);
      return;
    }
    assert.equal(row.colonnade + row.rim, row.plated, row.dish);
    if (row.plated >= row.stackSize * 2) {
      assert.ok(row.colonnade >= row.stackSize && row.rim >= row.stackSize, row.dish);
    }
  });
  const orange = results.find(row => row.dish === 'Orange Chicken');
  assert.equal(orange.skipped, false);
  assert.equal(orange.colonnade + orange.rim, 36);
});

test('rebalance moves half and leaves at least 5, oldest first is separate', () => {
  const before = [
    { name: '1/2# Turkey Chorizo (1)', colonnade: 25, rim: 0 },
    { name: '1/2# Baked Chicken (1)', colonnade: 4, rim: 0, orangeStarColonnade: 4 },
    { name: 'Greek Chicken Bowl', colonnade: 5, rim: 0 },
    { name: 'Beef Taco Skillet (2)', colonnade: 20, rim: 0 },
    { name: 'Picadillo', colonnade: 0, rim: 9 }
  ];
  const snapshot = JSON.parse(JSON.stringify(before));
  const suggestions = z.rebalanceSuggestions({ dishes: before, leaveAtLeast: 5, skipList: cfg.skipList });
  assert.deepEqual(before, snapshot);

  const chorizo = suggestions.find(s => s.name.indexOf('Turkey Chorizo') !== -1 && s.reason === 'surplus');
  assert.ok(chorizo);
  assert.equal(chorizo.from, 'colonnade');
  assert.equal(chorizo.to, 'rim');
  assert.equal(chorizo.qty, 12);

  const baked = suggestions.find(s => s.name.indexOf('Baked Chicken') !== -1);
  assert.ok(baked);
  assert.equal(baked.from, 'colonnade');
  assert.equal(baked.to, 'rim');
  assert.equal(baked.reason, 'orange-star');
  assert.equal(baked.qty, 2);

  assert.equal(suggestions.find(s => s.name === 'Greek Chicken Bowl' && s.reason === 'surplus'), undefined);
  assert.equal(suggestions.find(s => s.name.indexOf('Taco') !== -1), undefined);

  const otherWay = suggestions.find(s => s.name === 'Picadillo' && s.reason === 'surplus');
  assert.equal(otherWay.from, 'rim');
  assert.equal(otherWay.to, 'colonnade');
  assert.equal(otherWay.qty, 4);
});

test('empty case with backstock suggests a pull before a transfer', () => {
  const suggestions = z.rebalanceSuggestions({
    dishes: [{ name: 'Chili Mac', colonnade: 0, rim: 12, colonnadeBackstock: 8 }],
    leaveAtLeast: 5,
    skipList: []
  });
  const pull = suggestions.find(s => s.reason === 'backstock');
  const move = suggestions.find(s => s.reason === 'surplus');
  assert.equal(pull.from, 'colonnade_backstock');
  assert.equal(pull.to, 'colonnade');
  assert.equal(pull.qty, 8);
  assert.equal(move.from, 'rim');
  assert.equal(move.to, 'colonnade');
  assert.equal(move.qty, 6);
});

test('share shift moves one stack toward the out and away from orange star', () => {
  const proposals = z.proposeShareShifts({
    colonnadeShare: 0.6,
    stackRegular: 6,
    stackSmall: 7,
    smallMatchers: ['1/2#'],
    skipList: cfg.skipList,
    dishes: [
      { name: '1/2# Turkey Chorizo (1)', plated: 20 },
      { name: 'Rustic Chicken Parmesan (2)', plated: 230 },
      { name: 'Orange Chicken', plated: 40 }
    ],
    stockouts: [
      { name: '1/2# Turkey Chorizo (1)', store: 'rim' },
      { name: 'Rustic Chicken Parmesan (2)', store: 'colonnade' }
    ],
    orangeStar: [
      { name: '1/2# Turkey Chorizo (1)', store: 'colonnade', qty: 25 },
      { name: 'Rustic Chicken Parmesan (2)', store: 'rim', qty: 16 }
    ]
  });
  const chorizo = proposals.find(p => p.dish.indexOf('Turkey Chorizo') !== -1);
  assert.equal(chorizo.direction, 'rim');
  assert.ok(chorizo.next < chorizo.current);
  assert.equal(Math.round((chorizo.current - chorizo.next) * 20), 7);

  const rustic = proposals.find(p => p.dish.indexOf('Rustic') !== -1);
  assert.equal(rustic.direction, 'colonnade');
  assert.ok(rustic.next > rustic.current);

  assert.equal(proposals.find(p => p.dish === 'Orange Chicken'), undefined);
});

test('conflicting out and orange-star signals are not applied', () => {
  const proposals = z.proposeShareShifts({
    colonnadeShare: 0.6,
    stackRegular: 6,
    dishes: [{ name: 'Mahi', plated: 100 }],
    stockouts: [{ name: 'Mahi', store: 'rim' }],
    orangeStar: [{ name: 'Mahi', store: 'rim', qty: 9 }]
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].direction, 'none');
  assert.equal(proposals[0].next, proposals[0].current);
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

test('prepaid CSV: pickups follow the store, deliveries count toward the Rim', () => {
  const parsed = z.parsePrepaidCsv([
    'dish,store,qty,type',
    'Tex Mex Turkey Picadillo (1),Colonnade,4,pickup',
    'Tex Mex Turkey Picadillo (1),Rim,6,pickup',
    '"Arroz Con Pollo (2)",Colonnade,3,delivery',
    'Greek Chicken Bowl,rim,2'
  ].join('\n'));
  const totals = z.aggregateOrders(parsed);
  const pic = totals.find(r => r.dish.indexOf('Picadillo') !== -1);
  assert.equal(pic.prepaidColonnade, 4);
  assert.equal(pic.prepaidRim, 6);
  const arroz = totals.find(r => r.dish.indexOf('Arroz') !== -1);
  assert.equal(arroz.delivery, 3);
  assert.equal(arroz.prepaidColonnade, 0);
  const greek = totals.find(r => r.dish.indexOf('Greek') !== -1);
  assert.equal(greek.prepaidRim, 2);
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

test('barcode lookup ignores spaces and leading zeros', () => {
  const map = { '012345678905': { dish: 'Tex Mex Turkey Picadillo (1)' } };
  assert.equal(z.lookupBarcode('012345678905', map).dish, 'Tex Mex Turkey Picadillo (1)');
  assert.equal(z.lookupBarcode('*012345678905*', map).dish, 'Tex Mex Turkey Picadillo (1)');
  assert.equal(z.lookupBarcode('12345678905', map).dish, 'Tex Mex Turkey Picadillo (1)');
  assert.equal(z.lookupBarcode('999', map), null);
  assert.equal(z.normalizeBarcode(' 12 3* '), '123');
});
