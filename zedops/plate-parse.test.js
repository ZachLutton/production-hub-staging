const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const plate = require('./plate-parse.js');
const meals = require('./meal-supplies.js');
const storage = require('./storage.js');
const store = require('../inventory-store.js');

const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'plate-2026-11-04.txt'), 'utf8');

test('the 11/4 plate list total cook is 4897 and containers round up to a pallet case', async () => {
  const parsed = plate.parsePlateList(text);
  assert.equal(parsed.cookDate, '2026-11-04');
  assert.equal(parsed.totalCook, 4897);
  const supply = meals.list()[0];
  assert.equal(supply.id, 'meal_container');
  assert.equal(supply.perMeal, 1);
  assert.equal(supply.caseSize, 552);
  const empty = meals.lineFor(supply, 4897, 0);
  assert.equal(empty.need, 4897);
  assert.equal(empty.cases, 9);
  assert.equal(empty.pallet, true);
  assert.equal(meals.lineFor(supply, 4897, 4345).cases, 1);
  assert.equal(meals.lineFor(supply, 4897, 4897).cases, 0);
  assert.equal(meals.lineFor(supply, 4897, 5000).cases, 0);
  assert.equal(meals.lineFor(supply, 4897, 5000).pallet, false);
  const db = store.createInventoryDb({ storage: { getItem: function () { return null; }, setItem: function () {} } });
  await storage.setPlateTotal(db, '2026-11-04', { totalCook: 4897 });
  await storage.setPlateTotal(db, '2026-11-04', { totalCook: 4897 });
  const saved = (await db.ref('staging_zedops_plate/2026-11-04').once('value')).val();
  assert.equal(saved.totalCook, 4897);
  assert.equal(saved.cookDate, '2026-11-04');
  assert.throws(function () { storage.assertWritable('staging_zedops_plate'); });
});
