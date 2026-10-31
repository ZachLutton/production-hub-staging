const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const recipe = require('./recipe-parse.js');
const order = require('./order-math.js');
const store = require('../inventory-store.js');
const storage = require('./storage.js');
const locations = require('./locations.js');

const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'scaled-recipe-2026-11-04.txt'), 'utf8');
const parsed = recipe.parseScaledRecipes(text);

function pounds(name) {
  const row = recipe.purchaseByName(parsed, name);
  assert.ok(row, name + ' missing');
  return row.pounds;
}

test('scaled recipe uses raw weights and does not double count', () => {
  assert.equal(parsed.cookDate, '2026-11-04');
  assert.ok(Math.abs(pounds('Mahatma Jasmine Rice') - 113.4) < 0.05);
  assert.ok(Math.abs(pounds('Broccoli Florets') - 133.9) < 0.05);
  assert.ok(Math.abs(pounds('Asparagus, raw') - 31.2) < 0.05);
  assert.equal(recipe.purchaseByName(parsed, 'Buttered Jasmine Rice Cooked'), null);
  assert.equal(recipe.purchaseByName(parsed, 'Steamed Asparagus'), null);
  const broccoliUses = parsed.recipes.reduce(function (sum, recipeRow) {
    return sum + recipeRow.ingredients.filter(function (item) { return item.name === 'Broccoli Florets'; })
      .reduce(function (inner, item) { return inner + item.pounds; }, 0);
  }, 0);
  assert.ok(Math.abs(broccoliUses - 133.9) < 0.05);
  assert.ok(Math.abs(pounds('Broccoli Florets') - 133.9) < 0.05);
  assert.ok(Math.abs(pounds('4 oz Raw Chicken Breast') - 431.3) < 0.05);
});

test('cases always round up and an exact case does not', () => {
  assert.equal(order.packAmount('11 / 1 LB').perCase, 11);
  assert.equal(order.casesToOrder(31.2, 0, 11), 3);
  assert.equal(order.casesToOrder(22, 0, 11), 2);
  assert.equal(order.casesToOrder(31.2, 11, 11), 2);
  assert.equal(order.casesToOrder(10, 10, 5), 0);
  assert.equal(order.casesToOrder(113.4, 0, order.packAmount('1 / 25 LB').perCase), 5);
  assert.equal(order.casesToOrder(133.9, 0, order.packAmount('4 / 3 LB').perCase), 12);
  assert.equal(order.needInCountUnit(10, 'ea', 'lb', 0.5), 5);
});

test('a future store uses the supplies list, and two stores can save at once', async () => {
  const added = locations.addLocation({ locations: {} }, { name: 'San Pedro' });
  assert.equal(locations.listSourceOf(added.added), 'inventory');
  assert.equal(locations.listSourceOf({ isProductionHub: true }), 'catalog');
  const db = store.createInventoryDb({ storage: { getItem: function () { return null; }, setItem: function () {} } });
  await Promise.all([
    storage.setOnHand(db, 'store-a', '2026-11-03', 'bek__654028', 4),
    storage.setOnHand(db, 'store-b', '2026-11-03', 'bek__654028', 1.5),
    storage.setPar(db, 'store-b', 'bek__654028', { value: 2, unit: 'case' }),
    storage.setRecipeLine(db, '2026-11-03', 'mahatma_jasmine_rice', { name: 'Mahatma Jasmine Rice', pounds: 113.4, catalogId: 'bek__654028' })
  ]);
  const counts = (await db.ref('staging_zedops_counts').once('value')).val();
  assert.equal(counts['store-a']['2026-11-03'].bek__654028, 4);
  assert.equal(counts['store-b']['2026-11-03'].bek__654028, 1.5);
  assert.equal((await db.ref('staging_zedops_pars/store-b/bek__654028/value').once('value')).val(), 2);
  assert.equal((await db.ref('staging_zedops_recipe/2026-11-03/mahatma_jasmine_rice/pounds').once('value')).val(), 113.4);
  assert.throws(function () { storage.assertWritable('staging_zedops_recipe/2026-11-03'); });
});
