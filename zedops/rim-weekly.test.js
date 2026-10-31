const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const weekly = require('./weekly-hidden.js');
const bek = require('./bek.js');
const store = require('../inventory-store.js');

const tables = require('./weekly-location-items.json');

function memory() {
  const bag = {};
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null; },
    setItem: function (key, value) { bag[key] = String(value); }
  };
}

test('the Rim weekly list is the inventory list, not the BEK catalog', () => {
  const sections = weekly.sectionsFromSnapshot(tables.rim);
  assert.equal(Array.isArray(sections['Walk-in Cooler']), true);
  assert.equal(sections['Walk-in Cooler'][0].itemNumber, '106810');
  const count = Object.values(sections).reduce(function (sum, rows) { return sum + rows.length; }, 0);
  assert.ok(count > 200, 'rim list ' + count);
  assert.equal(sections['Plating Team Supplies'].some(function (item) { return item.itemNumber === '161647'; }), true);
  assert.equal(sections['Front of House Supplies'].some(function (item) { return item.name === 'Pumpkin Seeds'; }), true);
  const catalog = bek.buildCatalog(require('./seed.json'));
  assert.ok(count !== catalog.shelf.guide.length);
  const page = fs.readFileSync(path.join(__dirname, '..', 'weekly-order.html'), 'utf8');
  assert.equal(page.includes("db.ref('staging_inventory/' + loc + '/items')"), true);
  assert.equal(page.includes('weekly-location-items.json'), true);
  assert.equal(page.includes('staging_zedops_catalog'), false);
});

test('a list saved as an object still shows, and an existing list is not replaced', async () => {
  assert.deepEqual(weekly.itemList({ '1': { name: 'B' }, '0': { name: 'A' } }).map(function (item) { return item.name; }), ['A', 'B']);
  assert.equal(weekly.itemsNodeEmpty(null), true);
  assert.equal(weekly.itemsNodeEmpty({}), true);
  assert.equal(weekly.itemsNodeEmpty({ 'Walk-in Cooler': [] }), false);
  const chemicals = weekly.sectionsFromSnapshot({
    'Chemicals__SLASH__Janitorial Supplies': { '0': { itemNumber: '885818', name: 'Degreaser' } }
  });
  assert.equal(chemicals['Chemicals/Janitorial Supplies'][0].name, 'Degreaser');

  const db = store.createInventoryDb({ storage: memory() });
  const ref = db.ref('staging_inventory/rim/items');
  assert.equal(weekly.itemsNodeEmpty((await ref.once('value')).val()), true);
  await ref.transaction(function (current) {
    return weekly.itemsNodeEmpty(current) ? tables.rim : undefined;
  });
  await ref.child('Walk-in Cooler/0/name').set('Kept name');
  const second = await ref.transaction(function (current) {
    return weekly.itemsNodeEmpty(current) ? { wiped: true } : undefined;
  });
  assert.equal(second.committed, false);
  const saved = weekly.sectionsFromSnapshot((await ref.once('value')).val());
  assert.equal(saved['Walk-in Cooler'][0].name, 'Kept name');
  assert.equal((await db.ref('staging_inventory/rim/2026-10').once('value')).val(), null);
});

test('combined totals add Rim weekly on-hand to the Colonnade count by item number', () => {
  const sections = weekly.sectionsFromSnapshot(tables.rim);
  const item = sections['Walk-in Cooler'][0];
  const key = weekly.getItemKey('Walk-in Cooler', item, 0);
  const legacy = bek.legacyOnHandByItemNumber(
    { 'Walk-in Cooler': sections['Walk-in Cooler'] },
    {},
    { [key]: 2 },
    {}
  );
  const catalog = bek.buildCatalog(require('./seed.json'));
  const id = 'bek__' + item.itemNumber;
  const rows = bek.combineTotals({
    catalog: catalog,
    locations: [
      { id: 'colonnade', name: 'Colonnade', countsWeeklyBek: true, legacyWeekly: false },
      { id: 'rim', name: 'The Rim', countsWeeklyBek: false, legacyWeekly: true }
    ],
    countsByLocation: { colonnade: { [id]: 0.5 } },
    legacyByItemNumber: legacy
  });
  const row = rows.filter(function (entry) { return entry.id === id; })[0];
  assert.equal(row.cells.colonnade, 0.5);
  assert.equal(row.cells.rim, 2);
  assert.equal(row.total, 2.5);
});
