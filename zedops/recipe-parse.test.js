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

test('item search is fuzzy and the match count separates saved picks from blanks', () => {
  const items = [
    { id: 'bek__654028', itemNumber: '654028', name: 'Rice Jasmine', brand: 'Producers Rice Mill' },
    { id: 'bek__080089', itemNumber: '080089', name: 'Broccoli Floret Bite Size', brand: 'Markon' },
    { id: 'bek__179416', itemNumber: '179416', name: 'Asparagus Jumbo', brand: 'Markon First Crop' }
  ];
  assert.equal(order.filterCatalog('JASMINE', items)[0].id, 'bek__654028');
  assert.equal(order.filterCatalog('654028', items)[0].name, 'Rice Jasmine');
  assert.equal(order.filterCatalog('markon asp', items)[0].id, 'bek__179416');
  assert.equal(order.filterCatalog('zzzz-not-a-food', items).length, 0);
  assert.deepEqual(order.matchCounts([{ catalogId: 'bek__1' }, { catalogId: '' }, {}]), { matched: 1, unmatched: 2, total: 3 });
  const meal = { id: 'bek__meal', itemNumber: '111', name: 'Almond Meal', brand: 'Old' };
  const flour = { id: 'bek__flour', itemNumber: '222', name: 'Almond Flour', brand: 'New' };
  const hidden = {};
  hidden[meal.id] = true;
  assert.equal(order.filterCatalog('almond', [meal, flour], { hidden: hidden }).some(function (item) { return item.id === meal.id; }), false);
  assert.equal(order.filterCatalog('almond', [meal, flour], { hidden: hidden, showHidden: true }).some(function (item) { return item.id === meal.id; }), true);
  const replaced = order.planIngredientHide({ name: 'Almond Meal', pounds: 5.2 }, { mode: 'replace', catalogId: flour.id });
  assert.equal(replaced.ok, true);
  assert.equal(replaced.hideMode, 'replace');
  assert.equal(replaced.catalogId, flour.id);
  assert.equal(replaced.pounds, 5.2);
  const ignored = order.planIngredientHide({ name: 'Almond Meal', pounds: 5.2 }, { mode: 'ignore' });
  assert.equal(ignored.hideMode, 'ignore');
  assert.equal(ignored.catalogId, '');
  const fallback = order.planIngredientHide({ pounds: 5.2 }, {});
  assert.equal(fallback.ok, false);
  assert.equal(fallback.defaultMode, 'replace');
  assert.equal(storage.MATCH_HIDDEN, 'match');
  const noWeight = order.planIngredientHide({ name: 'Water', pounds: 0 }, {});
  assert.equal(noWeight.ok, true);
  assert.equal(noWeight.hideMode, 'ignore');
  const page = fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'weekly-order.html'), 'utf8');
  const handler = page.slice(page.indexOf("getElementById('recipeFile')"), page.indexOf("getElementById('guideFile')"));
  assert.equal(handler.includes('this.value'), false);
  assert.equal(page.includes('recipeStatus'), true);
  assert.equal(page.includes('setIngredientMatch'), true);
  assert.equal(page.includes('setMatchHidden'), true);
  assert.equal(page.includes('Replace with…'), true);
  assert.equal(page.includes("Ignore (don\\'t order)"), true);
  assert.equal(page.includes('No match'), true);
  assert.match(html, /id="recipeFile"[^>]*accept="application\/pdf,\.pdf"/);
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

  await storage.setMatchHidden(db, 'bek__meal', true);
  assert.equal((await db.ref('staging_zedops_hidden/match/bek__meal').once('value')).val(), true);
  await storage.setMatchHidden(db, 'bek__meal', false);
  assert.equal((await db.ref('staging_zedops_hidden/match/bek__meal').once('value')).val(), null);
  await storage.setIngredientMatch(db, 'almond_meal', {
    name: 'Almond Meal', catalogId: 'bek__flour', eachFactor: null, hideMode: 'replace'
  });
  await storage.setRecipeLine(db, '2026-11-03', 'almond_meal', {
    name: 'Almond Meal', pounds: 5.2, unit: 'lb', catalogId: 'bek__flour', eachFactor: null
  });
  const replacedLine = (await db.ref('staging_zedops_recipe/2026-11-03/almond_meal').once('value')).val();
  assert.equal(replacedLine.catalogId, 'bek__flour');
  assert.equal(replacedLine.pounds, 5.2);
  await storage.setIngredientMatch(db, 'almond_meal', {
    name: 'Almond Meal', catalogId: '', eachFactor: null, hideMode: 'ignore'
  });
  await storage.setRecipeLine(db, '2026-11-03', 'almond_meal', null);
  assert.equal((await db.ref('staging_zedops_recipe/2026-11-03/almond_meal').once('value')).val(), null);
  assert.equal((await db.ref('staging_zedops_ingredient_map/almond_meal/hideMode').once('value')).val(), 'ignore');
  assert.equal((await db.ref('staging_zedops_counts/store-a/2026-11-03/bek__654028').once('value')).val(), 4);
});
