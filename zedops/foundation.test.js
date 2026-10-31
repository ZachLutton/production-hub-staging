const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const bek = require('./bek.js');
const catalog = require('./catalog.js');
const schema = require('./schema.js');
const locations = require('./locations.js');
const storage = require('./storage.js');
const weekly = require('./weekly-hidden.js');
const price = require('./price-overlay.js');
const xlsx = require('./xlsx.js');
const pdf = require('./pdf.js');
const store = require('../inventory-store.js');
const backup = require('../scripts/backup-staging.js');

const seed = require('./seed.json');
const root = path.join(__dirname, '..');

function memory() {
  const bag = {};
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null; },
    setItem: function (key, value) { bag[key] = String(value); }
  };
}

test('the guide seed keeps 187 text item numbers, 12 shelf areas, and marsala by the gallon', () => {
  const built = bek.buildCatalog(seed);
  assert.equal(built.shelf.guide.length, 187);
  assert.equal(Object.keys(built.items).filter(function (id) { return built.items[id].kind === 'guide'; }).length, 187);
  assert.equal(built.items.bek__028201.itemNumber, '028201');
  assert.equal(built.items.bek__686207.name, 'Cooking Wine Marsala');
  assert.equal(built.items.bek__686207.countUnit, 'gallon');
  assert.equal(built.items.bek__686207.pack, '4 / 128 OZ');
  const labels = {};
  built.shelf.guide.forEach(function (id) { labels[built.items[id].label] = true; });
  assert.equal(Object.keys(labels).length, 12);
  assert.deepEqual(built.shelf.special.slice(0, 8), [
    'bek__883714', 'bek__563081', 'bek__563091', 'bek__210523', 'bek__155330', 'bek__172359', 'bek__1136442', 'bek__212500'
  ]);
  assert.equal(built.items.bek__local_salmon_4oz.internalKey, 'local_salmon_4oz');
  assert.equal(built.items.bek__local_salmon_4oz.itemNumber, '');
  assert.equal(built.items.bek__local_mahi_8oz.temporary, true);
  assert.equal(built.items.bek__local_mahi_8oz.countUnit, 'pound');
  assert.deepEqual(built.shelf.vendorChecks, [
    'labelmatch__labels', 'cpt__containers', 'airgas__ice_packs', 'michael_fleming__film'
  ]);
  assert.equal(catalog.VENDORS[0].id, 'bek');
  assert.equal(bek.defaultCountUnit('4 / 5 LB', ''), 'pound');
  assert.equal(bek.defaultCountUnit('6 / #10 CAN', ''), 'can');
  const again = bek.diffUpload(built, { kind: 'guide', rows: seed.guide });
  assert.equal(again.empty, true, JSON.stringify({ moved: again.moved.length, added: again.added.length, dropped: again.dropped.length, up: again.priceUp.length, down: again.priceDown.length }));
  const specials = bek.diffUpload(built, { kind: 'special', rows: seed.special });
  assert.equal(specials.empty, true);
});

test('a guide diff shows moves, adds, drops, substitutions, and price changes, and does not reset count units', () => {
  const current = bek.buildCatalog({
    guide: [
      { itemNumber: '747050', name: 'Old Cheese', pack: '1 / 5 LB', price: 10, label: 'Walk-in Cooler', par: 1 },
      { itemNumber: '028201', name: 'Juice Lemon Fresh Squeezed', pack: '6 / .5 GAL', price: 10.24, label: 'Walk-in Cooler', par: 1 }
    ],
    special: []
  });
  current.items.bek__028201.countUnit = 'each';
  const diff = bek.diffUpload(current, {
    kind: 'guide',
    rows: [
      { itemNumber: '555001', name: 'New Cheese', pack: '1 / 5 LB', price: 12, label: 'Walk-in Cooler', par: 1, tempZone: 'Refrigeration Item is replacing item 747050' },
      { itemNumber: '028201', name: 'Juice Lemon Fresh Squeezed', pack: '6 / .5 GAL', price: 9.5, label: 'Produce', par: 1 },
      { itemNumber: '080089', name: 'Broccoli', pack: '4 / 3 LB', price: 4, label: 'Produce', par: 2 }
    ]
  });
  assert.deepEqual(diff.substitutions.map(function (row) { return [row.from.itemNumber, row.to.itemNumber]; }), [['747050', '555001']]);
  assert.equal(diff.added.some(function (row) { return row.itemNumber === '555001' || row.itemNumber === '747050'; }), false);
  assert.equal(diff.dropped.some(function (row) { return row.itemNumber === '747050'; }), false);
  assert.equal(diff.added.some(function (row) { return row.itemNumber === '080089'; }), true);
  assert.equal(diff.moved.some(function (row) { return row.itemNumber === '028201' && row.toLabel === 'Produce'; }), true);
  assert.equal(diff.priceDown.some(function (row) { return row.itemNumber === '028201' && row.from === 10.24 && row.to === 9.5; }), true);
  const writes = bek.planUpload(current, diff);
  assert.equal(writes.some(function (write) { return write.path.indexOf('staging_zedops_counts') === 0; }), false);
  assert.equal(writes.some(function (write) {
    return write.op === 'update' && write.value && Object.prototype.hasOwnProperty.call(write.value, 'countUnit');
  }), false);
  assert.equal(writes.some(function (write) { return write.path === 'staging_zedops_catalog/shelf/guide' && write.value[1] === 'bek__028201'; }), true);
});

test('reordering and re-uploading keeps counts and an edited count unit', async () => {
  const db = store.createInventoryDb({ storage: memory() });
  await bek.prepareDatabase(db, seed);
  await storage.setCountUnit(db, 'bek__028201', 'bottle');
  await storage.setOnHand(db, 'loc-a', '2026-10-27', 'bek__028201', 0.5);
  await storage.setOnHand(db, 'loc-b', '2026-10-27', 'bek__686207', 2);
  const before = (await db.ref('staging_zedops_catalog').once('value')).val();
  const guide = catalog.asList(before.shelf.guide);
  const moved = guide[guide.length - 1];
  const reordered = [moved].concat(guide.slice(0, -1));
  await db.ref('staging_zedops_catalog/shelf/guide').set(reordered);
  await bek.prepareDatabase(db, seed);
  const afterSeed = (await db.ref('staging_zedops_catalog/shelf/guide').once('value')).val();
  assert.equal(catalog.asList(afterSeed)[0], moved);
  assert.equal((await db.ref('staging_zedops_catalog/items/bek__028201/countUnit').once('value')).val(), 'bottle');

  const catalogNow = schema.migrateCatalog((await db.ref('staging_zedops_catalog').once('value')).val());
  const rows = catalog.asList(catalogNow.shelf.guide).map(function (id) {
    const item = catalogNow.items[id];
    return {
      itemNumber: item.itemNumber, name: item.name, brand: item.brand, pack: item.pack,
      tempZone: item.tempZone, price: id === 'bek__028201' ? Number(item.price) + 1 : item.price,
      each: item.each, par: item.guidePar, label: item.label, weeklyCaseAverage: item.weeklyCaseAverage,
      specialPricing: item.specialPricing
    };
  });
  const last = rows.pop();
  rows.unshift(last);
  const diff = bek.diffUpload(catalogNow, { kind: 'guide', rows: rows });
  assert.equal(diff.empty, false);
  await storage.applyWrites(db, bek.planUpload(catalogNow, diff));
  const counts = (await db.ref('staging_zedops_counts').once('value')).val();
  assert.equal(counts['loc-a']['2026-10-27'].bek__028201, 0.5);
  assert.equal(counts['loc-b']['2026-10-27'].bek__686207, 2);
  assert.equal((await db.ref('staging_zedops_catalog/items/bek__028201/countUnit').once('value')).val(), 'bottle');
  assert.equal((await db.ref('staging_zedops_catalog/items/bek__local_mahi_8oz/temporary').once('value')).val(), true);
});

test('two stores can enter different items at the same time without erasing each other', async () => {
  const db = store.createInventoryDb({ storage: memory() });
  await Promise.all([
    storage.setOnHand(db, 'store-a', '2026-10-27', 'bek__111', 1.25),
    storage.setOnHand(db, 'store-a', '2026-10-27', 'bek__222', 4),
    storage.setOnHand(db, 'store-b', '2026-10-27', 'bek__111', 9)
  ]);
  const counts = (await db.ref('staging_zedops_counts').once('value')).val();
  assert.equal(counts['store-a']['2026-10-27'].bek__111, 1.25);
  assert.equal(counts['store-a']['2026-10-27'].bek__222, 4);
  assert.equal(counts['store-b']['2026-10-27'].bek__111, 9);
  assert.throws(function () { storage.assertWritable('staging_zedops_counts'); });
  assert.throws(function () { storage.assertWritable('staging_zedops_counts/store-a/2026-10-27'); });
  assert.throws(function () { storage.assertWritable('staging_inventory/main/items'); });
  assert.throws(function () { storage.assertWritable('staging_weekly_orders/rim/pars'); });
});

test('schema migrations are idempotent and do not drop an edited count unit', () => {
  const once = schema.migrateAll({
    schemaVersion: 0,
    items: [{ id: 'bek__028201', vendor: 'bek', itemNumber: '028201', name: 'Lemon', kind: 'guide', countUnit: 'gallon' }],
    counts: { a: { '2026-10-27': { '028201': 0.25, bek__999: 3 } } },
    locations: [{ id: 'bitters', name: 'Bitters', isCulinaryCenter: true, isProductionHub: false }]
  });
  once.catalog.items.bek__028201.countUnit = 'bottle';
  const twice = schema.migrateAll(once);
  assert.deepEqual(twice, schema.migrateAll(twice));
  assert.equal(once.counts.a['2026-10-27'].bek__028201, 0.25);
  assert.equal(once.counts.a['2026-10-27']['028201'], undefined);
  assert.equal(once.counts.a['2026-10-27'].bek__999, 3);
  assert.equal(twice.catalog.items.bek__028201.countUnit, 'bottle');
  assert.equal(twice.catalog.shelf.guide[0], 'bek__028201');
  assert.equal(twice.locations.locations.bitters.isCulinaryCenter, true);
  assert.equal(twice.locations.locations.bitters.isProductionHub, false);
  assert.throws(function () { schema.migrateAll({ schemaVersion: 99 }); });
});

test('any store can be the culinary center or the production hub', () => {
  const doc = { locations: {} };
  locations.defaultLocations().forEach(function (loc) { doc.locations[loc.id] = loc; });
  const added = locations.addLocation(doc, { name: 'Bitters', isCulinaryCenter: true, countsWeeklyBek: true });
  assert.equal(added.added.id, 'bitters');
  assert.equal(added.locations.bitters.isCulinaryCenter, true);
  assert.equal(added.locations.bitters.isProductionHub, false);
  assert.equal(added.locations[locations.defaultLocations()[0].id].isCulinaryCenter, true);
  const both = locations.withRole(added, 'bitters', 'isProductionHub', true);
  assert.equal(both.locations.bitters.isProductionHub, true);
  assert.equal(both.locations.bitters.isCulinaryCenter, true);
  const src = fs.readFileSync(path.join(__dirname, 'locations.js'), 'utf8');
  const logic = src.slice(0, src.indexOf('var DEFAULT_LOCATIONS')) + src.slice(src.indexOf('var ROLES'));
  assert.equal(/colonnade/i.test(logic), false);
  assert.equal(/\brim\b/i.test(logic), false);
  ['bek.js', 'count-page.js', 'combined-page.js', 'storage.js', 'catalog.js'].forEach(function (file) {
    assert.equal(/colonnade/i.test(fs.readFileSync(path.join(__dirname, file), 'utf8')), false, file);
  });
  ['bek-count.html', 'bek-combined.html'].forEach(function (file) {
    assert.equal(/colonnade/i.test(fs.readFileSync(path.join(root, file), 'utf8')), false, file);
  });
});

test('the count week is the Tuesday it is due, in Chicago, and prices wait for the last Monday', () => {
  assert.equal(bek.countWeekTuesday(new Date('2026-10-26T15:00:00-05:00')), '2026-10-27');
  assert.equal(bek.countWeekTuesday(new Date('2026-10-27T20:00:00-05:00')), '2026-10-27');
  assert.equal(bek.countWeekTuesday(new Date('2026-10-28T09:00:00-05:00')), '2026-10-27');
  assert.equal(bek.isLastMonday(new Date('2026-10-26T21:30:00-05:00')), true);
  assert.equal(bek.isLastMonday(new Date('2026-10-19T12:00:00-05:00')), false);
  assert.equal(bek.isLastMonday(new Date('2026-10-27T12:00:00-05:00')), false);
  assert.equal(bek.isLastMonday(new Date('2026-11-30T12:00:00-06:00')), true);
  const catalogBuilt = bek.buildCatalog({
    guide: [{ itemNumber: '028201', name: 'Lemon', pack: '6 / .5 GAL', price: 11, label: 'Walk-in Cooler', par: 1 }],
    special: []
  });
  assert.throws(function () { bek.buildPriceApproval(catalogBuilt, new Date('2026-10-27T12:00:00-05:00')); });
  const approval = bek.buildPriceApproval(catalogBuilt, new Date('2026-10-26T15:00:00-05:00'));
  assert.equal(approval.month, '2026-10');
  assert.equal(approval.prices['028201'], 11);
  const changes = bek.priceChanges(catalogBuilt, [{ itemNumber: '028201', price: 10 }]);
  assert.equal(changes.up.length, 1);
  assert.equal(price.approvedPrice('028201', 10, null), 10);
  assert.equal(price.monthTotal([{ itemNumber: '028201', price: 10, qty: 2 }, { itemNumber: '1', price: 3, qty: 1, hidden: true }], null), 23);
  assert.equal(price.monthTotal([{ itemNumber: '028201', price: 10, qty: 2 }], approval), 22);
});

test('combined totals add partial units by item number and skip hidden monthly rows', () => {
  const built = bek.buildCatalog(seed);
  const items = {
    'Walk-in Cooler': [
      { itemNumber: '028201', name: 'Lemon', hidden: true },
      { itemNumber: '686207', name: 'Marsala' }
    ]
  };
  const key = weekly.getItemKey('Walk-in Cooler', items['Walk-in Cooler'][1], 1);
  const legacy = bek.legacyOnHandByItemNumber(items, {}, { [key]: 1.5 }, {});
  assert.equal(legacy['028201'], undefined);
  assert.equal(legacy['686207'].onHand, 1.5);
  const rows = bek.combineTotals({
    catalog: built,
    locations: [
      { id: 'hub', name: 'Hub', countsWeeklyBek: true, legacyWeekly: false },
      { id: 'rim', name: 'The Rim', countsWeeklyBek: false, legacyWeekly: true }
    ],
    countsByLocation: { hub: { bek__686207: 0.25, bek__local_salmon_4oz: 2 } },
    legacyByItemNumber: legacy
  });
  const marsala = rows.filter(function (row) { return row.id === 'bek__686207'; })[0];
  assert.equal(marsala.cells.hub, 0.25);
  assert.equal(marsala.cells.rim, 1.5);
  assert.equal(marsala.total, 1.75);
  const salmon = rows.filter(function (row) { return row.id === 'bek__local_salmon_4oz'; })[0];
  assert.equal(salmon.total, 2);
  assert.equal(rows.some(function (row) { return row.id === 'labelmatch__labels'; }), false);
  assert.equal(weekly.isRowHidden({ hidden: true }, {}, 'k'), true);
  assert.equal(weekly.isRowHidden({ name: 'Kept' }, { k: true }, 'k'), true);
});

test('a downloaded PDF is a real PDF and a spreadsheet keeps a leading zero', async () => {
  const bytes = pdf.buildPdf({ title: 'Weekly BEK count', lines: ['Cooking Wine Marsala #686207 on hand 0.5 gallon'] });
  const text = Buffer.from(bytes).toString('latin1');
  assert.equal(text.startsWith('%PDF-1.4'), true);
  assert.equal(text.includes('Cooking Wine Marsala'), true);
  assert.equal(text.includes('%%EOF'), true);

  const shared = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Item #</t></si><si><t>Item Name</t></si><si><t>Pack / Size</t></si><si><t>Price</t></si><si><t>Label Name</t></si><si><t>028201</t></si><si><t>Juice Lemon</t></si><si><t>6 / .5 GAL</t></si><si><t>Walk-in Cooler</t></si></sst>';
  const sheet = '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row><row><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" t="s"><v>7</v></c><c r="D2"><v>10.24</v></c><c r="E2" t="s"><v>8</v></c></row></sheetData></worksheet>';
  const matrix = await xlsx.parseXlsx(zipStore({
    'xl/sharedStrings.xml': shared,
    'xl/worksheets/sheet1.xml': sheet
  }));
  const parsed = bek.rowsFromMatrix(matrix);
  assert.equal(parsed.kind, 'guide');
  assert.equal(parsed.rows[0].itemNumber, '028201');
  assert.equal(parsed.rows[0].price, 10.24);
});

test('monthly and Rim weekly data shapes stay put, and September uses saved prices unless that month was approved', () => {
  const monthly = fs.readFileSync(path.join(root, 'monthly-inventory.html'), 'utf8');
  const weeklyLogic = fs.readFileSync(path.join(root, 'zedops', 'weekly-page.js'), 'utf8');
  assert.equal(monthly.includes('const total = price * onHand'), true);
  assert.equal(monthly.includes("db.ref('staging_inventory/' + loc + '/items')"), true);
  assert.equal(monthly.includes("const path = 'staging_inventory/' + location + '/' + monthKey;"), true);
  assert.equal(monthly.includes("return 's_' + sectionId + '_' + sanitized + '_' + idx;"), true);
  assert.equal(monthly.includes('staging_zedops_counts'), false);
  assert.equal(monthly.includes('staging_zedops_price_approvals'), true);
  assert.equal(weeklyLogic.includes('staging_weekly_orders/'), true);
  assert.equal(weeklyLogic.includes('staging_inventory/'), true);
  assert.equal(weeklyLogic.includes('getItemKey'), true);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  assert.equal(config.database.rules, 'database.rules.json');
  const rc = fs.readFileSync(path.join(root, '.firebaserc'), 'utf8');
  assert.equal(rc.includes('zedops-staging'), false);
  // No approval for September: the total is the saved price times the saved count.
  assert.equal(price.monthTotal([{ itemNumber: '106810', price: 35.33, qty: 4 }], null), 141.32);
});

test('the staging backup refuses the live project and never invents a database url', () => {
  const live = ['zedrics', 'production-hub'].join('-');
  assert.throws(function () { backup.assertStagingTarget('', ''); });
  assert.throws(function () { backup.assertStagingTarget('https://' + live + '-default-rtdb.firebaseio.com', 'zedops-staging'); });
  assert.throws(function () { backup.assertStagingTarget('https://zedops-staging-default-rtdb.firebaseio.com', live); });
  const url = backup.assertStagingTarget('https://zedops-staging-default-rtdb.firebaseio.com', 'zedops-staging');
  const envelope = backup.buildEnvelope({ databaseURL: url, projectId: 'zedops-staging', data: { staging_zedops_schema: { schemaVersion: 1 } }, rules: {}, exportedAt: '2026-10-30T00:00:00.000Z' });
  assert.equal(envelope.databaseURL.includes(live), false);
  assert.equal(envelope.counts.staging_zedops_schema.leaves, 1);
  assert.equal(envelope.data.staging_zedops_schema.schemaVersion, 1);
});

function zipStore(files) {
  const parts = [];
  Object.keys(files).forEach(function (name) {
    const data = Buffer.from(files[name]);
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, comp);
  });
  return Buffer.concat(parts);
}
