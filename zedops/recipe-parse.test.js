const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const recipe = require('./recipe-parse.js');
const order = require('./order-math.js');
const bek = require('./bek.js');
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

test('a scaled recipe header names its Wednesday cook date', () => {
  const sample = recipe.parseScaledRecipes('Scaled Recipes for Wednesday Nov 11, 2026\n');
  assert.equal(sample.cookDate, '2026-11-11');
  assert.equal(recipe.parseScaledRecipes(text).cookDate, '2026-11-04');
  const decoy = [
    'Posted Monday Nov 03, 2026',
    'Generated on Saturday Oct 31, 2026 03:10:41',
    'Colonnade Scaled Recipes for Wednesday Nov 04, 2026'
  ].join('\n');
  assert.equal(recipe.parseScaledRecipes(decoy).cookDate, '2026-11-04');
});

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
  const brisket = parsed.recipes.filter(function (row) { return row.name === 'Seasoned Brisket (COOKED)'; })[0];
  const brisketMeat = brisket.ingredients.filter(function (item) { return /brisket, whole/.test(item.name); })[0];
  assert.equal(brisketMeat.pounds, 70.8);
  assert.equal(brisketMeat.name, 'Beef, brisket, whole, separable lean only, trimmed to 0" fat, all grades, cooked, braised');
  assert.equal(brisket.ingredients.filter(function (item) { return item.name === 'Spices, pepper, black'; })[0].pounds, 0.1);
  assert.equal(brisket.ingredients.filter(function (item) { return item.name === 'Kosher Salt'; })[0].pounds, 0.3);
  assert.equal(pounds(brisketMeat.name), 70.8);
  const powder = recipe.purchaseByName(parsed, 'Leavening agents, baking powder, low-sodium');
  const soda = recipe.purchaseByName(parsed, 'Leavening agents, baking soda');
  assert.ok(Math.abs(powder.pounds - (7 / 453.59237)) < 0.001);
  assert.ok(Math.abs(soda.pounds - (6.5 / 453.59237)) < 0.001);
  assert.deepEqual(powder.sources, ['Chocolate Pecan Zucchini Muffin Bulk']);
  const powderItem = bek.buildCatalog(require('./seed.json')).items.bek__696005;
  const sodaItem = bek.buildCatalog(require('./seed.json')).items.bek__696131;
  assert.equal(order.filterCatalog(powder.name, [powderItem, sodaItem], { solidOnly: true })[0].itemNumber, '696005');
  assert.equal(order.filterCatalog(soda.name, [powderItem, sodaItem], { solidOnly: true })[0].itemNumber, '696131');
  assert.equal(order.orderCases(powderItem, { quantity: powder.pounds, unit: 'lb', source: 'recipe' }, 0), 1);
  assert.equal(order.orderCases(powderItem, { quantity: powder.pounds, unit: 'lb', source: 'recipe' }, 5), 0);
  assert.equal(order.orderCases(sodaItem, { quantity: soda.pounds, unit: 'lb', source: 'recipe' }, 5), 0);
  assert.equal(fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8').includes('isFoodItem(item)'), true);
  const brisketItem = bek.buildCatalog(require('./seed.json')).items.bek__500370;
  assert.equal(order.filterCatalog(brisketMeat.name, Object.values(bek.buildCatalog(require('./seed.json')).items), { solidOnly: true })[0].itemNumber, '500370');
  assert.equal(order.packAmount('1 / 9-11 LB').perCase, 10);
  assert.equal(order.packAmount('1 / 9-11 LB').each, 10);
  assert.equal(order.orderCases(brisketItem, { quantity: 70.8, unit: 'lb', source: 'recipe' }, 0), 8);
  const brisketLines = {
    garnish: { name: 'Kosher Salt', pounds: 0.2, catalogId: 'bek__500370', unit: 'lb' },
    meat: { name: brisketMeat.name, pounds: 70.8, catalogId: 'bek__774055', unit: 'lb' }
  };
  assert.equal(order.recipeLineFor(brisketItem, brisketLines).pounds, 70.8);
  assert.equal(order.recipeLineFor({ id: 'bek__774055', name: 'Oregano Leaves' }, brisketLines), null);
  const tenderloin = parsed.broadline.filter(function (row) { return row.name === 'Diced Beef Tenderloin'; })[0];
  assert.equal(tenderloin.ingredients[0].pounds, 90.4);
  assert.equal(tenderloin.ingredients[0].name, 'Beef, loin, tenderloin steak, boneless, separable lean only, trimmed to 0" fat, choice, raw');
  assert.equal(pounds("Chef Paul Prudhomme's Blackened Redfish Magic Seasoning Blends"), 0.8);
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
  const milk = {
    id: 'bek__171985', itemNumber: '171985', name: 'Milk Lowfat 1% Gallon',
    pack: '4 / 1 GAL', countUnit: 'gallon', tempZone: 'Refrigeration'
  };
  assert.equal(order.packAmount('4 / 1 GAL').perCase, 4);
  assert.equal(order.packAmount('4 / 1 GAL').unit, 'gal');
  assert.equal(order.packAmount('6 / .5 GAL').perCase, 3);
  assert.equal(order.packAmount('1 / 1 QT').unit, 'qt');
  assert.equal(order.packAmount('4 / 128 OZ').perCase, 512);
  assert.equal(order.perCaseInCountUnit(order.packAmount('4 / 128 OZ'), 'gallon'), 4);
  const gallons = order.needInCountUnit(40.1, 'lb', 'gallon', null, null);
  assert.ok(Math.abs(gallons - (40.1 / 8.6)) < 1e-9);
  assert.equal(order.orderCases(milk, { quantity: 40.1, unit: 'lb' }, 7), 0);
  assert.equal(order.orderCases(milk, { quantity: 40.1, unit: 'lb' }, 0), 2);
  assert.equal(order.orderCases(milk, { quantity: 8.6 * 4, unit: 'lb' }, 0), 1);
  assert.equal(order.orderCases(milk, { quantity: 8.6 * 4.1, unit: 'lb' }, 0), 2);
  const heavier = Object.assign({}, milk, { lbPerUnit: 10 });
  assert.ok(order.needInCountUnit(40.1, 'lb', 'gal', null, 10) < gallons);
  assert.equal(order.orderCases(heavier, { quantity: 40.1, unit: 'lb' }, 7), 0);
  const need = order.orderNeed(milk, { recipe: { quantity: 40.1, unit: 'lb' }, countUnit: 'gallon' });
  assert.equal(order.needText(need), '40.1 lb ≈ 4.7 gal');
  const salt = bek.buildCatalog(require('./seed.json')).items.bek__183640;
  assert.equal(salt.pack, '12 / 3 LB');
  assert.equal(salt.countUnit, 'each');
  assert.equal(order.isFoodItem(salt), true);
  assert.equal(order.isFoodItem(Object.assign({}, salt, { orderRole: 'supply' })), false);
  assert.equal(order.resolvedCountUnit(Object.assign({}, salt, { countUnit: 'pound' })), 'each');
  assert.equal(order.resolvedCountUnit(Object.assign({}, salt, { countUnit: 'lb', countUnitChosen: true })), 'lb');
  const saltLb = pounds('Kosher Salt');
  const saltNeed = order.orderNeed(salt, { recipe: { quantity: saltLb, unit: 'lb' }, countUnit: 'each' });
  assert.ok(saltLb > 5.8);
  assert.equal(order.needText(saltNeed).indexOf('box') > 0, true);
  assert.equal(order.orderCases(salt, { quantity: 5.8, unit: 'lb' }, 0), 1);
  assert.equal(order.orderCases(salt, { quantity: 5.8, unit: 'lb' }, 2), 0);
  assert.equal(order.orderCases(salt, { quantity: 36, unit: 'lb' }, 0), 1);
  assert.equal(order.orderCases(salt, { quantity: 36.1, unit: 'lb' }, 0), 2);
  assert.equal(order.filterCatalog('Kosher Salt', [salt], { solidOnly: true })[0].itemNumber, '183640');
  const glaze = {
    name: 'Glaze Balsamic', brand: 'Roland', pack: '6 / 12.9 OZ', countUnit: 'ounce',
    tempZone: 'Dry', label: 'Plating Team Supplies', itemNumber: '660356'
  };
  const vinegar = { name: 'Vinegar Balsamic', pack: '2 / 5 LTR', countUnit: 'liter', tempZone: 'Dry', itemNumber: '686235' };
  const pecanShelf = { name: 'Pecan Pieces Medium Fancy', pack: '1 / 5 LB', countUnit: 'pound', tempZone: 'Retail Ready Item Dry', label: 'Label Printing Table' };
  assert.equal(order.isFoodItem(glaze), true);
  assert.equal(order.isFoodItem(Object.assign({}, glaze, { orderRole: 'supply' })), false);
  assert.equal(order.resolvedCountUnit(glaze), 'each');
  assert.equal(order.resolvedCountUnit(Object.assign({}, glaze, { countUnit: 'oz', countUnitChosen: true })), 'oz');
  const glazeNeed = order.orderNeed(glaze, { recipe: { quantity: 1, unit: 'lb' }, standingPar: 4, countUnit: 'each' });
  assert.equal(glazeNeed.source, 'recipe');
  assert.equal(order.needText(glazeNeed), '1 lb ≈ 1.2 bottle');
  assert.equal(order.orderCases(glaze, glazeNeed, 0), 1);
  assert.equal(order.orderCases(glaze, glazeNeed, 2), 0);
  assert.equal(order.needInCountUnit(1, 'lb', 'oz'), 16);
  assert.equal(order.filterCatalog('Balsamic Glaze', [glaze, vinegar], { solidOnly: true })[0].itemNumber, '660356');
  assert.equal(order.filterCatalog('Vinegar, balsamic', [glaze, vinegar], { solidOnly: true })[0].itemNumber, '686235');
  const pecanNeed = order.orderNeed(pecanShelf, { recipe: { quantity: 3, unit: 'lb' }, standingPar: 9, countUnit: 'pound' });
  assert.equal(pecanNeed.source, 'recipe');
  assert.equal(pecanNeed.quantity, 3);
  const glazeInFile = recipe.purchaseByName(parsed, 'Balsamic Glaze') || recipe.purchaseByName(parsed, 'Glaze, balsamic');
  assert.equal(glazeInFile, null);
  const vinegarLine = { name: 'Vinegar, balsamic', pounds: 1.2, catalogId: 'bek__686235', unit: 'lb' };
  const glazeLine = { name: 'Balsamic Glaze', pounds: 1.2, catalogId: 'bek__686235', unit: 'lb' };
  assert.equal(order.forcedRecipeItemId(vinegarLine), '');
  assert.equal(order.forcedRecipeItemId(glazeLine), 'bek__660356');
  assert.equal(order.recipeLineFor({ id: 'bek__660356', name: 'Glaze Balsamic' }, { glaze: glazeLine, vinegar: vinegarLine }).pounds, 1.2);
  assert.equal(order.recipeLineFor({ id: 'bek__686235', name: 'Vinegar Balsamic' }, { glaze: glazeLine, vinegar: vinegarLine }).pounds, 1.2);
  const glazeItem = bek.buildCatalog(require('./seed.json')).items.bek__660356;
  assert.equal(glazeItem.pack, '6 / 12.9 OZ');
  assert.equal(order.resolvedCountUnit(glazeItem), 'each');
  assert.equal(order.orderCases(glazeItem, { quantity: 1.2, unit: 'lb', source: 'recipe' }, 0), 1);
  assert.equal(fs.readFileSync(path.join(__dirname, 'order-math.js'), 'utf8').includes('salt sea kosher'), true);
  assert.equal(fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8').includes('usesSuggestedRecipe'), true);
  const honey = { name: 'Honey Pure Blend', pack: '4 / 1 GAL', countUnit: 'gallon', tempZone: 'Refrigeration', itemNumber: '793069' };
  const honeyNeed = order.orderNeed(honey, { recipe: { quantity: 12.6, unit: 'lb' }, countUnit: 'gallon' });
  assert.equal(order.needText(honeyNeed), '12.6 lb ≈ 1.1 gal');
  assert.equal(order.orderCases(honey, honeyNeed, 8.75), 0);
  assert.equal(order.orderCases(honey, honeyNeed, 0.25), 1);
  assert.equal(order.orderCases(Object.assign({}, honey, { countUnit: 'each' }), honeyNeed, 8.75), 0);
  assert.equal(order.orderCases(Object.assign({}, honey, { lbPerUnit: 10 }), honeyNeed, 8.75), 0);
  const maple = { name: 'Syrup Maple Dark', pack: '4 / 1 GAL', countUnit: 'gallon', tempZone: 'Dry', label: 'Spice Rack', itemNumber: '793062' };
  assert.equal(order.isFoodItem(maple), false);
  assert.equal(order.isPantryLiquid(maple), true);
  const mapleNeed = order.orderNeed(maple, { recipe: { quantity: 3.1, unit: 'lb' }, countUnit: 'gallon', forceFood: true });
  assert.equal(mapleNeed.source, 'recipe');
  assert.equal(order.needText(mapleNeed), '3.1 lb ≈ 0.3 gal');
  assert.equal(order.orderCases(maple, mapleNeed, 0), 1);
  assert.equal(order.orderCases(maple, mapleNeed, 1), 0);
  const oil = { name: 'Oil Olive Pomace', pack: '4 / 1 GAL', countUnit: 'gallon', tempZone: 'Dry' };
  const oilNeed = order.orderNeed(oil, { recipe: { quantity: 10.2, unit: 'lb' }, countUnit: 'gallon', forceFood: true });
  assert.equal(order.needText(oilNeed), '10.2 lb ≈ 1.3 gal');
  const liquidPlan = order.planRecipeApproval([
    { key: 'syrups_maple', name: 'Syrups, maple', pounds: 3.1, catalogId: 'bek__793062', matchSaved: false, includeInOrder: true },
    { key: 'cumin_line', name: 'Cumin', pounds: 1, catalogId: 'bek__774055', matchSaved: false }
  ], '2026-11-11');
  assert.equal(liquidPlan.matches.syrups_maple, undefined);
  assert.equal(liquidPlan.lines.syrups_maple.pounds, 3.1);
  assert.equal(liquidPlan.lines.cumin_line, undefined);
  const tzatzikiBlock = recipe.parseScaledRecipes(text).recipes.filter(function (row) { return row.name === 'Tzatziki Sauce'; })[0];
  assert.equal(tzatzikiBlock.yieldPounds, 4.7);
  const tzatziki = bek.buildCatalog(require('./seed.json')).items.bek__483810;
  assert.equal(tzatziki.pack, '4 / 0.5 GAL');
  assert.equal(tzatziki.countUnit, 'gallon');
  assert.equal(order.isFoodItem(tzatziki), true);
  assert.equal(order.packAmount(tzatziki.pack).perCase, 2);
  assert.equal(order.perCaseInCountUnit(order.packAmount(tzatziki.pack), 'gallon'), 2);
  const tzNeed = order.orderNeed(tzatziki, { recipe: { quantity: tzatzikiBlock.yieldPounds, unit: 'lb' }, countUnit: 'gallon' });
  assert.equal(order.needText(tzNeed), '4.7 lb ≈ 0.5 gal · 1.1 × 0.5 gal');
  assert.ok(Math.abs(tzNeed.convertedQuantity - (4.7 / 8.6)) < 1e-9);
  assert.equal(order.resolvedCountUnit(tzatziki), 'tub');
  assert.equal(order.orderCases(tzatziki, tzNeed, 0), 1);
  assert.equal(order.orderCases(tzatziki, tzNeed, 0.5), 1);
  assert.equal(order.orderCases(tzatziki, tzNeed, 2.875), 0);
  assert.equal(order.casesToOrder(4.7, 0, 2), 3);
  assert.equal(order.orderCases({ pack: '11 / 1 LB', countUnit: 'pound' }, { quantity: 31.2, unit: 'lb' }, 0), 3);
  const turkey = { name: 'Turkey Sausage Patty Cooked', pack: '128 / 1.25 OZ', countUnit: 'lb', itemNumber: '492773', tempZone: 'Frozen' };
  assert.equal(order.perCaseInCountUnit(order.packAmount(turkey.pack), 'lb'), 10);
  assert.equal(order.orderCases(turkey, { quantity: 6.3, unit: 'lb' }, 4), 1);
  assert.equal(order.orderCases(turkey, { quantity: 6.3, unit: 'lb' }, 0), 1);
  assert.equal(order.orderCases(turkey, { quantity: 10, unit: 'lb' }, 0), 1);
  const omelette = { name: 'Egg Omelette W/cheddar Chs', pack: '72 / 3.5 OZ', countUnit: 'lb', itemNumber: '393795', tempZone: 'Frozen' };
  assert.equal(order.perCaseInCountUnit(order.packAmount(omelette.pack), 'lb'), 15.75);
  assert.equal(order.packAmount(omelette.pack).each / 16, 0.21875);
  assert.equal(Math.round(14 / 0.21875), 64);
  const plateOmelette = order.orderNeed(omelette, { plateList: { quantity: 90, unit: 'each' }, recipe: { quantity: 0, unit: 'lb' }, standingPar: 2, countUnit: 'lb' });
  assert.equal(plateOmelette.source, 'plate list');
  assert.equal(plateOmelette.quantity, 90);
  assert.equal(order.orderCases(omelette, plateOmelette, 14), 1);
  assert.equal(order.orderCases(omelette, plateOmelette, 90 * 0.21875), 0);
  const onion = bek.buildCatalog(require('./seed.json')).items.bek__1136442;
  assert.equal(onion.name, 'onion caramelized');
  assert.equal(onion.pack, '12/2');
  assert.equal(onion.countUnit, 'each');
  assert.equal(order.packAmount('12/2').perCase, 24);
  assert.equal(order.packAmount('12/2').each, 2);
  assert.equal(order.packAmount('12/2').unit, 'lb');
  assert.equal(order.packAmount('24/.8'), null);
  assert.equal(order.packAmount('12/16').unit, 'oz');
  assert.equal(order.packAmount('12/16').each, 16);
  assert.equal(order.packAmount('12/16').perCase, 192);
  assert.equal(order.packAmount('8/13.22'), null);
  assert.equal(order.isFoodItem(onion), true);
  assert.equal(order.usesSuggestedRecipe(onion), true);
  const onionLines = [];
  parsed.recipes.forEach(function (recipeRow) {
    if (!/egg bite/i.test(recipeRow.name)) return;
    recipeRow.ingredients.forEach(function (ingredient) {
      if (/caramelized onion/i.test(ingredient.name)) onionLines.push(recipeRow.name + ' ' + ingredient.pounds + ' ' + ingredient.name);
    });
  });
  assert.deepEqual(onionLines, ['Bacon & Gruyere Egg Bite Filling 2.5 Sliced Caramelized Onions']);
  const onionPurchase = recipe.purchaseByName(parsed, 'Sliced Caramelized Onions');
  assert.equal(onionPurchase.pounds, 2.5);
  assert.deepEqual(onionPurchase.sources, ['Bacon & Gruyere Egg Bite Filling']);
  assert.equal(order.filterCatalog('Sliced Caramelized Onions', [onion], { solidOnly: true })[0].itemNumber, '1136442');
  const redOnionPurchase = recipe.purchaseByName(parsed, 'Red Onion');
  assert.equal(redOnionPurchase.pounds, 1.5);
  assert.deepEqual(redOnionPurchase.sources, ['Pickled Red Onion']);
  const dicedOnionPurchase = recipe.purchaseByName(parsed, 'Diced Red Onion');
  assert.equal(dicedOnionPurchase.pounds, 21.8);
  const slab = { itemNumber: '182907', name: 'Onion Red Slab Slice 1/4 In', pack: '1 / 5 LB', countUnit: 'pound', tempZone: 'Refrigeration' };
  const dicedOnion = { itemNumber: '231714', name: 'Onion Red Diced 1/4 Inch', pack: '2 / 5 LB', countUnit: 'pound', tempZone: 'Refrigeration' };
  assert.equal(order.filterCatalog('Red Onion', [dicedOnion, slab], { solidOnly: true })[0].itemNumber, '182907');
  assert.equal(order.filterCatalog('Diced Red Onion', [dicedOnion, slab], { solidOnly: true })[0].itemNumber, '231714');
  const slabNeed = order.orderNeed(slab, { recipe: { quantity: redOnionPurchase.pounds, unit: 'lb' }, countUnit: 'pound' });
  assert.equal(slabNeed.quantity, 1.5);
  assert.equal(order.orderCases(slab, slabNeed, 0), 1);
  const savedLines = {
    diced_red_onion: { name: 'Diced Red Onion', pounds: 21.6, catalogId: 'bek__231714', unit: 'lb' },
    red_onion: { name: 'Red Onion', pounds: 1.5, catalogId: 'bek__231714', unit: 'lb' }
  };
  assert.equal(order.forcedRecipeItemId(savedLines.red_onion), 'bek__182907');
  assert.equal(order.recipeLineFor({ id: 'bek__182907' }, savedLines).pounds, 1.5);
  assert.equal(order.recipeLineFor({ id: 'bek__231714' }, savedLines).pounds, 21.6);
  assert.equal(order.usesSuggestedRecipe(Object.assign({ id: 'bek__182907' }, slab)), true);
  const marinara = { name: 'Sauce Marinara Rtu', pack: '6 / #10 CAN', countUnit: 'can', itemNumber: '660333', tempZone: 'Dry' };
  assert.equal(order.packAmount(marinara.pack).each, 6.5);
  assert.equal(order.packAmount(marinara.pack).perCase, 39);
  assert.equal(order.packAmount(marinara.pack).cans, 6);
  assert.equal(order.canEachLb('6 / #5 CAN'), 3.5);
  assert.equal(order.canEachLb('6 / #2.5 CAN'), 1.75);
  assert.equal(order.resolvedCountUnit(marinara), 'can');
  assert.equal(order.defaultPieceLb(marinara), 6.5);
  assert.equal(order.isFoodItem(marinara), true);
  const marinaraNeed = order.orderNeed(marinara, { recipe: { quantity: 94, unit: 'lb' }, countUnit: 'each' });
  assert.equal(order.needText(marinaraNeed), '94 lb ≈ 14.5 cans');
  assert.equal(order.orderCases(marinara, marinaraNeed, 7), 2);
  assert.equal(order.orderCases(Object.assign({}, marinara, { lbPerUnit: 7 }), marinaraNeed, 7), 2);
  const crushed = { name: 'Tomato Crushed Angela Mia', pack: '6 / #10 CAN', countUnit: 'can', tempZone: 'Dry' };
  const enchilada = { name: 'Sauce Enchilada Mild Rtu', pack: '6 / #10 CAN', countUnit: 'can', tempZone: 'Dry' };
  const ketchup = { name: 'Ketchup Fancy', pack: '6 / #10 CAN', countUnit: 'can', tempZone: 'Dry' };
  const applesauce = { name: 'Applesauce Unsweetened Fancy', pack: '6 / #10 CAN', countUnit: 'can', tempZone: 'Dry' };
  const beans = { name: 'Bean Black In Brine', pack: '6 / #10 CAN', countUnit: 'can', tempZone: 'Dry' };
  function casesFor(item, pounds, onHand) {
    return order.orderCases(item, order.orderNeed(item, { recipe: { quantity: pounds, unit: 'lb' }, countUnit: 'each' }), onHand);
  }
  assert.equal(casesFor(crushed, 39.8, 0), 2);
  assert.equal(casesFor(crushed, 39.8, 2), 1);
  assert.equal(casesFor(enchilada, 18.9, 0), 1);
  assert.equal(casesFor(ketchup, 5.3, 0), 1);
  assert.equal(casesFor(ketchup, 5.3, 3), 0);
  assert.equal(casesFor(applesauce, 2.8, 0), 1);
  assert.equal(casesFor(beans, 17.1, 0), 1);
  assert.equal(order.filterCatalog('Angela Mia Marinara Sauce', [marinara], { solidOnly: true })[0].itemNumber, '660333');
  assert.equal(order.filterCatalog('Angela Mia Crushed Tomatoes', [crushed], { solidOnly: true })[0].name, crushed.name);
  const onionNeed = order.orderNeed(onion, { recipe: { quantity: onionPurchase.pounds, unit: 'lb' }, countUnit: 'each', forceFood: true });
  assert.equal(onionNeed.quantity, 2.5);
  assert.equal(order.orderCases(onion, onionNeed, 0), 1);
  assert.equal(order.orderCases(onion, onionNeed, 2), 0);
  const eggLines = parsed.purchases.filter(function (row) { return /omelette|omelet|egg/i.test(row.name); }).map(function (row) { return row.pounds + ' ' + row.name; });
  assert.equal(eggLines.some(function (line) { return /omelette w\/cheddar|393795/i.test(line); }), false);
  const salmon = { name: '4 oz salmon filets', pack: '10 lb case', countUnit: 'pound', tempZone: 'Frozen', kind: 'special' };
  assert.equal(order.resolvedCountUnit(salmon), 'each');
  assert.equal(order.defaultPieceLb(salmon), 0.25);
  assert.equal(order.orderCases(salmon, { quantity: 21.3, unit: 'lb' }, 30), 2);
  assert.equal(order.orderCases(salmon, { quantity: 21.3, unit: 'lb', eachFactor: 0.5 }, 30), 1);
  assert.equal(order.perCaseInCountUnit(order.packAmount('4 / 128 OZ'), 'gallon'), 4);
  const page = fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8');
  assert.equal(page.includes('data-lb-per'), true);
  assert.equal(page.includes('showCanEach'), true);
  assert.equal(page.includes('row-controls'), true);
  assert.equal(page.includes('orderResult'), true);
  assert.equal(page.includes('orderLabel'), true);
});

test('cook list pieces use the pack, and peanut butter is 12 jars of 16 oz', () => {
  const catalog = bek.buildCatalog(require('./seed.json'));
  const cook = require('./cook-parse.js');
  const parsed = cook.parseCookList(fs.readFileSync(path.join(__dirname, 'fixtures/cook-list-2026-11-11.txt'), 'utf8'));
  function ordered(id, onHand) {
    const item = catalog.items[id];
    const found = cook.piecesForItem(item, parsed.components, {});
    const need = { quantity: found.quantity, unit: 'each', source: 'cook list' };
    return order.orderResult(item, need, onHand || 0);
  }
  const salmon = ordered('bek__local_salmon_4oz', 0);
  assert.equal(salmon.unit, 'cs');
  assert.equal(salmon.amount, 3);
  assert.equal(ordered('bek__local_salmon_4oz', 30).amount, 2);
  assert.equal(ordered('bek__211262').amount, 22);
  assert.equal(ordered('bek__202105').amount, 4);
  assert.equal(ordered('bek__185095').amount, 5);
  assert.equal(ordered('bek__555070').amount, 3);
  assert.equal(ordered('bek__492773').amount, 1);
  assert.equal(ordered('bek__522402').amount, 7);
  const hash = ordered('bek__172359');
  assert.equal(hash.unit, 'ea');
  assert.equal(hash.amount, 132);
  const thigh = ordered('bek__121792');
  assert.equal(thigh.unit, 'ea');
  assert.equal(thigh.amount, 110);
  const peanut = catalog.items.bek__212500;
  assert.equal(order.resolvedCountUnit(peanut), 'jar');
  assert.equal(order.packAmount(peanut.pack).each, 16);
  assert.equal(order.piecesPerCase(peanut), 12);
  const peanutNeed = { quantity: 3.3, unit: 'lb', source: 'recipe' };
  assert.equal(order.orderResult(peanut, peanutNeed, 0).amount, 1);
  assert.equal(order.orderResult(peanut, peanutNeed, 0).unit, 'cs');
  assert.equal(order.orderResult(peanut, peanutNeed, 2).amount, 1);
  assert.equal(order.orderResult(peanut, peanutNeed, 4).amount, 0);
  const stored = Object.assign({}, peanut, { pack: '12/16', countUnit: 'each' });
  assert.equal(order.orderResult(stored, peanutNeed, 0).amount, 1);
});

test('gallon, carton, and chip rows order in the count unit', () => {
  const catalog = bek.buildCatalog(require('./seed.json'));
  const milk = catalog.items.bek__171985;
  const milkNeed = order.orderNeed(milk, { recipe: { quantity: 40.1, unit: 'lb' }, countUnit: 'gallon' });
  assert.equal(order.needText(milkNeed), '40.1 lb ≈ 4.7 gal');
  assert.equal(order.orderResult(milk, milkNeed, 0).amount, 2);
  assert.equal(order.orderResult(milk, milkNeed, 4).amount, 1);
  assert.equal(order.orderResult(milk, milkNeed, 5).amount, 0);
  const whites = catalog.items.bek__393413;
  assert.equal(whites.pack, '15 / 2 LB');
  assert.equal(order.resolvedCountUnit(whites), 'carton');
  assert.equal(order.packAmount(whites.pack).perCase / order.packAmount(whites.pack).each, 15);
  assert.equal(order.pieceWeightLb(whites), 2);
  const whiteNeed = order.orderNeed(whites, { recipe: { quantity: 25.8, unit: 'lb' }, countUnit: 'each' });
  assert.equal(order.needText(whiteNeed), '25.8 lb ≈ 12.9 carton');
  assert.equal(order.orderResult(whites, whiteNeed, 0).amount, 1);
  assert.equal(order.orderResult(whites, whiteNeed, 12).amount, 1);
  assert.equal(order.orderResult(whites, whiteNeed, 13).amount, 0);
  const blend = catalog.items.bek__120564;
  const blendNeed = { quantity: 79.3, unit: 'lb', source: 'recipe' };
  assert.equal(order.orderResult(blend, blendNeed, 0).amount, 2);
  assert.equal(order.orderResult(blend, blendNeed, 40).amount, 1);
  assert.equal(order.orderResult(blend, blendNeed, 80).amount, 0);
  const chips = catalog.items.bek__800401;
  assert.equal(order.resolvedCountUnit(chips), 'bag');
  const chipNeed = { quantity: 1, unit: 'lb', source: 'recipe' };
  assert.equal(order.orderResult(chips, chipNeed, 12).amount, 0);
  assert.equal(order.orderResult(chips, chipNeed, 0).amount, 1);
  assert.equal(order.orderResult(Object.assign({}, chips, { countUnit: 'ounce' }), chipNeed, 12).amount, 0);
  const tz = catalog.items.bek__483810;
  const tzSmall = order.orderNeed(tz, { recipe: { quantity: 3, unit: 'lb' }, countUnit: 'gallon' });
  assert.equal(order.needText(tzSmall).includes('0.7 × 0.5 gal'), true);
  assert.equal(tz.pack, '4 / 0.5 GAL');
  assert.equal(order.resolvedCountUnit(tz), 'tub');
  assert.equal(order.orderResult(tz, tzSmall, 0).amount, 1);
  assert.equal(order.orderResult(tz, tzSmall, 2.875).amount, 0);
  const lemon = catalog.items.bek__028201;
  const lemonNeed = order.orderNeed(lemon, { recipe: { quantity: 4.1, unit: 'lb' }, countUnit: 'gallon' });
  assert.equal(order.needText(lemonNeed).includes('1 × 0.5 gal'), true);
  assert.equal(order.orderResult(lemon, lemonNeed, 0).amount, 1);
  const almond = catalog.items.bek__798099;
  assert.equal(order.resolvedCountUnit(almond), 'gal');
  const almondNeed = order.orderNeed(almond, { recipe: { quantity: 20.5, unit: 'lb' }, countUnit: 'gal' });
  assert.equal(order.needText(almondNeed).includes('oz'), false);
  assert.equal(order.orderResult(almond, almondNeed, 0).amount, 1);
  const bacon = catalog.items.bek__131513;
  assert.equal(order.orderResult(bacon, { quantity: 12.4, unit: 'lb', source: 'recipe' }, 0).amount, 2);
  const cream = catalog.items.bek__669027;
  assert.equal(cream.pack, '4 / 5 LB');
  assert.equal(order.resolvedCountUnit(cream), 'tub');
  assert.equal(order.orderResult(cream, { quantity: 20.2, unit: 'lb', source: 'recipe' }, 0).amount, 2);
  assert.equal(order.orderResult(cream, { quantity: 20.2, unit: 'lb', source: 'recipe' }, 0.6).amount, 1);
  assert.equal(fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8').includes('handLabel'), true);
  assert.equal(order.orderExplain({ name: 'Asparagus', pack: '1 / 5 LB', countUnit: 'pound' }, { quantity: 21, unit: 'lb', source: 'recipe' }, 6), '21 lb need − 6 lb on hand = 15 lb ÷ 5 lb/cs → 3 cs');
  assert.equal(order.orderExplain(milk, milkNeed, 0), '4.7 gal need − 0 gal on hand = 4.7 gal ÷ 4 gal/cs → 2 cs');
  assert.equal(order.orderExplain(whites, whiteNeed, 12), '12 carton × 2 lb = 24 lb on hand. Saved 12 kept as cartons, not converted from lb. 12.9 carton need − 12 carton on hand = 0.9 carton ÷ 15 carton/cs → 1 cs');
  assert.equal(order.orderExplain(blend, blendNeed, 0), '79.3 lb need − 0 lb on hand = 79.3 lb ÷ 40 lb/cs → 2 cs');
  assert.equal(order.orderExplain(chips, { quantity: 0.6, unit: 'lb', source: 'recipe' }, 12), '0.6 lb need − 12 bags (9 lb) on hand = 0 lb → 0 cs');
  assert.equal(order.orderResult(chips, { quantity: 0.6, unit: 'lb', source: 'recipe' }, 12).amount, 0);
  assert.equal(order.bagsFromPounds(9), 12);
  assert.equal(order.orderResult(chips, { quantity: 0.6, unit: 'lb', source: 'recipe' }, 0).amount, 1);
  const mashed = catalog.items.bek__106810;
  assert.equal(mashed.pack, '4 / 6 LB');
  assert.equal(order.packAmount(mashed.pack).perCase, 24);
  assert.equal(order.resolvedCountUnit(mashed), 'pound');
  const mashedNeed = { quantity: 149.3, unit: 'lb', source: 'recipe' };
  const mashedByCase = Object.assign({}, mashed, { countUnit: 'case', countUnitChosen: true });
  assert.equal(order.orderCases(mashedByCase, mashedNeed, 1), 6);
  assert.equal(order.orderExplain(mashedByCase, mashedNeed, 1), '149.3 lb need − 1 cs × 24 lb = 125.3 lb ÷ 24 lb/cs → 6 cs');
  assert.equal(order.orderExplain(mashed, mashedNeed, 1), '149.3 lb need − 1 lb on hand = 148.3 lb ÷ 24 lb/cs → 7 cs');
  const squash = catalog.items.bek__200305;
  assert.equal(squash.pack, '1 / 1 CS');
  assert.equal(order.resolvedOrderUnit(squash), 'lb');
  const squashNeed = { quantity: 27.7, unit: 'lb', source: 'recipe' };
  assert.deepEqual(order.orderResult(squash, squashNeed, 0), { amount: 27.7, unit: 'lb' });
  assert.equal(order.orderExplain(squash, squashNeed, 0), '27.7 lb need − 0 lb on hand = 27.7 lb');
  assert.equal(order.orderWarning(squash, 28, squashNeed, 0).flagged, false);
  assert.equal(order.resolvedOrderUnit(Object.assign({}, squash, { orderUnit: 'case', orderUnitChosen: true })), 'cs');
  const lime = Object.assign({}, catalog.items.bek__029210, { countUnit: 'each', countUnitChosen: true });
  assert.equal(order.resolvedCountUnit(lime), 'gal');
  const limeNeed = order.orderNeed(lime, { recipe: { quantity: 13.2, unit: 'lb' }, countUnit: order.resolvedCountUnit(lime), forceFood: true });
  assert.equal(order.needText(limeNeed), '13.2 lb ≈ 1.5 gal · 3.1 × 0.5 gal');
  assert.equal(order.orderResult(lime, limeNeed, 0).amount, 1);
  assert.equal(order.orderExplain(lime, limeNeed, 0), '1.5 gal need − 0 gal on hand = 1.5 gal ÷ 3 gal/cs → 1 cs');
  assert.equal(order.orderExplain(lime, limeNeed, 0).includes('0 ea'), false);
  const butter = catalog.items.bek__389120;
  assert.equal(order.orderExplain(butter, { quantity: 2.5, unit: 'lb', source: 'recipe' }, 0), '2.5 lb need − 0 lb on hand = 2.5 lb ÷ 36 lb/cs → 1 cs');
  assert.equal(order.orderResult(butter, { quantity: 2.5, unit: 'lb', source: 'recipe' }, 0).amount, 1);
  Object.keys(catalog.items).forEach(function (id) {
    const item = catalog.items[id];
    const pack = order.packAmount(item && item.pack);
    if (!pack || !order.isVolumeUnit(pack.unit)) return;
    const forced = Object.assign({}, item, { countUnit: 'each', countUnitChosen: true });
    assert.equal(order.canonUnit(order.resolvedCountUnit(forced)) === 'ea', false, item.itemNumber + ' ' + item.pack);
  });
  Object.keys(catalog.items).forEach(function (id) {
    const item = catalog.items[id];
    const pack = order.packAmount(item && item.pack);
    if (!pack || (pack.unit !== 'lb' && pack.unit !== 'oz' && pack.unit !== 'gal' && pack.unit !== 'qt')) return;
    const line = order.orderExplain(Object.assign({}, item, { countUnit: 'case', countUnitChosen: true }), { quantity: 10, unit: 'lb', source: 'recipe' }, 1);
    assert.equal(line.includes('case need'), false, (item.itemNumber || id) + ' ' + line);
    assert.equal(line.includes('case/cs'), false, (item.itemNumber || id) + ' ' + line);
  });
  const page = fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8');
  assert.equal(page.includes('need-math'), true);
  assert.equal(page.includes('orderExplain'), true);
});

test('a standard weight applies until the item overrides it, and a wild order is flagged', () => {
  const standards = order.defaultStandards();
  assert.equal(standards.can10, 6.5);
  assert.equal(standards.gal, 8.6);
  assert.equal(standards.qt, 2.15);
  order.useStandards({ can10: 7 });
  const can = { name: 'Sauce Marinara Rtu', pack: '6 / #10 CAN', countUnit: 'each', tempZone: 'Dry' };
  assert.equal(order.canEachLb(can.pack), 7);
  assert.equal(order.weightSource(can).source, 'standard');
  assert.equal(order.weightSource(Object.assign({}, can, { lbPerUnit: 6 })).source, 'override');
  assert.equal(order.weightSource({ name: '4 oz salmon filets', pack: '10 lb case', countUnit: 'each' }).label, 'oz in the name');
  assert.equal(order.weightSource({ name: 'Turkey Sausage Patty Cooked', pack: '128 / 1.25 OZ', countUnit: 'lb' }).label, 'pack ounces');
  order.useStandards(null);
  assert.equal(order.canEachLb(can.pack), 6.5);
  const high = order.orderWarning({ weeklyCaseAverage: 2 }, 12, { quantity: 1, unit: 'lb' }, 0);
  assert.equal(high.flagged, true);
  assert.equal(high.reasons[0].includes('3×'), true);
  const noHistory = order.orderWarning({ weeklyCaseAverage: 0 }, 11, { quantity: 1, unit: 'lb' }, 0);
  assert.equal(noHistory.flagged, true);
  const quiet = order.orderWarning({ name: 'Sauce Marinara Rtu', pack: '6 / #10 CAN', countUnit: 'each', weeklyCaseAverage: 3 }, 2, { quantity: 94, unit: 'lb', convertedQuantity: 14.5 }, 7);
  assert.equal(quiet.flagged, false);
  const aboveHand = order.orderWarning({ weeklyCaseAverage: 1, countUnit: 'lb' }, 2, { quantity: 40, unit: 'lb' }, 2);
  assert.equal(aboveHand.flagged, true);
  const forced = order.orderNeed({ name: 'Tomato Crushed', pack: '6 / #10 CAN', orderRole: 'supply', tempZone: 'Dry' }, {
    recipe: { quantity: 39.8, unit: 'lb' }, forceFood: true, countUnit: 'each', standingPar: 4
  });
  assert.equal(forced.source, 'standing par');
  assert.equal(forced.quantity, 4);
  const backToFood = order.orderNeed({ name: 'Tomato Crushed', pack: '6 / #10 CAN', orderRole: 'food', tempZone: 'Dry' }, {
    recipe: { quantity: 39.8, unit: 'lb' }, countUnit: 'each'
  });
  assert.equal(backToFood.source, 'recipe');
  assert.equal(backToFood.quantity, 39.8);
  const page = fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8');
  assert.equal(page.includes('function requireAdmin'), true);
  assert.equal(page.includes('Only an admin can change that'), true);
  const rules = fs.readFileSync(path.join(__dirname, '..', 'database.rules.staging.json'), 'utf8');
  assert.equal(rules.includes('"staging_zedops_counts"'), true);
  const parsed = JSON.parse(rules);
  assert.equal(parsed.rules.staging_zedops_counts['.write'].includes('team@'), true);
  assert.equal(parsed.rules.staging_zedops_catalog['.write'].includes('team@'), false);
  assert.equal(parsed.rules.staging_zedops_standards['.write'].includes('admin@'), true);
  assert.equal(parsed.rules.staging_zedops_pars['.write'].includes('team@'), false);
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

test('food follows the temp zone, even on a supply shelf, and a supply par saves on its own', async () => {
  const pecan = {
    id: 'bek__122588', name: 'Pecan Pieces Medium Fancy', brand: 'Ellington Farms',
    pack: '1 / 5 LB', tempZone: 'Retail Ready Item Dry', label: 'Label Printing Table'
  };
  const sticker = { name: 'Label 3 In Use First Orange', tempZone: 'Dry', label: 'Label Printing Table' };
  assert.equal(order.isFoodItem(pecan), true);
  assert.equal(order.isFoodItem(sticker), false);
  assert.equal(order.isFoodItem(Object.assign({}, pecan, { orderRole: 'supply' })), false);
  assert.equal(order.isFoodItem(Object.assign({}, sticker, { orderRole: 'food' })), true);
  const cumin = { name: 'Cumin Comino Ground', label: 'Saute Line', pack: '1 / 4.5 LB', countUnit: 'pound', tempZone: 'Dry', itemNumber: '774055' };
  const oregano = { name: 'Oregano Leaves', label: 'Saute Line', pack: '1 / 24 OZ', countUnit: 'ounce', tempZone: 'Dry', itemNumber: '774146' };
  const vanilla = { name: 'Extract Vanilla Pure', label: 'Spice Rack', pack: '1 / 1 QT', countUnit: 'quart', tempZone: 'Dry' };
  assert.equal(order.isFoodItem(cumin), true);
  assert.equal(order.isFoodItem(oregano), true);
  assert.equal(order.isFoodItem(Object.assign({}, cumin, { orderRole: 'supply' })), false);
  assert.equal(order.isFoodItem(vanilla), true);
  assert.equal(order.isFoodItem(Object.assign({}, vanilla, { orderRole: 'supply' })), false);
  assert.equal(order.isFoodItem(Object.assign({}, vanilla, { orderRole: 'food' })), true);
  const vinegarChips = { name: 'Pop Chips - Salt and Vinegar', label: 'Front of House Supplies', pack: '24 / 0.8 OZ', countUnit: 'case' };
  const bbqChips = { name: 'Pop Chips - BBQ', label: 'Front of House Supplies', pack: '24 / 0.8 OZ', countUnit: 'case' };
  const vanillaShake = { name: 'Nurri Vanilla Protein Shake', label: 'Front of House Supplies', pack: '1/12pk', countUnit: 'case' };
  assert.equal(order.isRetailResale(vinegarChips), true);
  assert.equal(order.isFoodItem(vinegarChips), false);
  assert.equal(order.isFoodItem(bbqChips), false);
  assert.equal(order.isFoodItem(vanillaShake), false);
  assert.equal(order.isFoodItem(Object.assign({}, vinegarChips, { orderRole: 'food' })), true);
  const chipNeed = order.orderNeed(vinegarChips, { recipe: { quantity: 2, unit: 'lb' }, standingPar: 1, countUnit: 'case', forceFood: true });
  assert.equal(chipNeed.source, 'standing par');
  assert.equal(chipNeed.quantity, 1);
  const switched = order.orderNeed(Object.assign({}, vinegarChips, { orderRole: 'supply' }), {
    recipe: { quantity: 2, unit: 'lb' }, standingPar: 1, countUnit: 'case', forceFood: true
  });
  assert.equal(switched.source, 'standing par');
  const vinegarItem = { name: 'Vinegar Balsamic', itemNumber: '686235', label: 'Spice Rack' };
  const saltItem = { name: 'Salt Sea Kosher Coarse', itemNumber: '183640', label: 'Spice Rack' };
  const butter = { name: 'Butter Unsalted European Style', itemNumber: '389120', label: 'Walk-in Cooler' };
  assert.equal(order.filterCatalog('Vinegar', [vinegarChips, vinegarItem], { solidOnly: true })[0].itemNumber, '686235');
  assert.equal(order.filterCatalog('Salt', [vinegarChips, saltItem, butter], { solidOnly: true })[0].itemNumber, '183640');
  const flips = order.weakFoodReport([vinegarChips, bbqChips, vanillaShake, vinegarItem], ['Vinegar', 'Kosher Salt', 'Apple Cider Vinegar']);
  assert.deepEqual(flips.map(function (row) { return row.name; }).sort(), ['Nurri Vanilla Protein Shake', 'Pop Chips - Salt and Vinegar']);
  assert.equal(order.isFoodItem(sticker), false);
  const cuminNeed = order.orderNeed(cumin, { recipe: { quantity: 2.5, unit: 'lb' }, countUnit: 'pound' });
  assert.equal(cuminNeed.source, 'recipe');
  assert.equal(order.orderCases(cumin, cuminNeed, 0), 1);
  assert.equal(order.orderCases(cumin, cuminNeed, 2.5), 0);
  assert.equal(order.orderCases(cumin, { quantity: 4.5, unit: 'lb' }, 0), 1);
  const oreganoNeed = order.orderNeed(oregano, { recipe: { quantity: 0.2, unit: 'lb' }, countUnit: 'ounce' });
  assert.equal(order.needText(oreganoNeed), '0.2 lb ≈ 3.2 oz');
  assert.equal(order.orderCases(oregano, oreganoNeed, 0), 1);
  assert.equal(order.orderCases(oregano, oreganoNeed, 3.2), 0);
  assert.equal(order.needInCountUnit(453.59237, 'g', 'oz'), 16);
  const spices = bek.buildCatalog(require('./seed.json')).items;
  function topSpice(name) {
    return order.filterCatalog(name, Object.keys(spices).map(function (id) { return spices[id]; }), { solidOnly: true })[0];
  }
  assert.equal(topSpice('Spice, ground cumin').itemNumber, '774055');
  assert.equal(topSpice('Spices, chili powder').itemNumber, '115608');
  assert.equal(topSpice('Spices, paprika').itemNumber, '104932');
  assert.equal(topSpice('Spices, pepper, black').itemNumber, '128173');
  assert.equal(topSpice('Crushed Red Pepper Flakes').itemNumber, '774411');
  assert.equal(topSpice('Spices, oregano, dried').itemNumber, '774146');
  assert.equal(topSpice('Spices, thyme, dried').itemNumber, '774223');
  assert.equal(topSpice("Chef Paul Prudhomme's Blackened Redfish Magic Seasoning Blends").itemNumber, '774477');
  assert.equal(topSpice('blackening seasoning').itemNumber, '774477');
  assert.equal(topSpice('blackened seasoning').itemNumber, '774477');
  const blackened = bek.buildCatalog(require('./seed.json')).items.bek__774477;
  assert.equal(order.resolvedCountUnit(blackened), 'lb');
  assert.equal(order.perCaseInCountUnit(order.packAmount(blackened.pack), 'lb'), 6);
  assert.equal(order.orderCases(blackened, { quantity: 0.8, unit: 'lb', source: 'recipe' }, 0), 1);
  assert.equal(order.recipeLineFor(blackened, {
    seasoning: { name: "Chef Paul Prudhomme's Blackened Redfish Magic Seasoning Blends", pounds: 0.8, catalogId: '', unit: 'lb' }
  }).pounds, 0.8);
  assert.equal(topSpice('Seeds, sesame seeds, whole, dried').itemNumber, '101922');
  assert.equal(topSpice('Syrups, maple').itemNumber, '793062');
  assert.equal(topSpice('Oil, sesame, salad or cooking').itemNumber, '779181');
  assert.equal(topSpice('Lime Juice, Fresh').itemNumber, '029210');
  assert.equal(topSpice('Roland Capers').itemNumber, '685406');
  const capers = spices.bek__685406;
  assert.equal(order.resolvedCountUnit(capers), 'jar');
  assert.equal(order.packAmount(capers.pack).each, 32);
  assert.equal(order.orderCases(capers, { quantity: 0.3, unit: 'lb', source: 'recipe' }, 0), 1);
  assert.equal(order.orderCases(capers, { quantity: 0.3, unit: 'lb', source: 'recipe' }, 4), 0);
  assert.equal(order.orderCases(capers, { quantity: 0.3, unit: 'lb', source: 'recipe' }, 5), 0);
  const oats = spices.bek__799205;
  assert.equal(oats.pack, '12 / 42 OZ');
  assert.equal(order.resolvedCountUnit(oats), 'container');
  assert.equal(order.resolvedCountUnit(Object.assign({}, oats, { countUnit: 'ounce', countUnitChosen: true })), 'container');
  const oatNeed = order.orderNeed(oats, { recipe: { quantity: 10.3, unit: 'lb' }, countUnit: 'each' });
  assert.equal(order.needText(oatNeed), '10.3 lb ≈ 3.9 containers');
  assert.equal(order.orderCases(oats, oatNeed, 10.3), 0);
  assert.equal(order.orderCases(oats, oatNeed, 0), 1);
  const evap = spices.bek__798001;
  assert.equal(evap.pack, '24 / 12 OZ');
  assert.equal(order.resolvedCountUnit(evap), 'can');
  const evapNeed = order.orderNeed(evap, { recipe: { quantity: 1.6, unit: 'lb' }, countUnit: 'each', forceFood: true });
  assert.equal(order.needText(evapNeed), '1.6 lb ≈ 2.1 cans');
  assert.equal(order.orderCases(evap, evapNeed, 6), 0);
  assert.equal(order.orderExplain(evap, evapNeed, 6).indexOf('Saved 6 kept as cans, not converted from oz') > -1, true);
  assert.equal(order.orderExplain(evap, evapNeed, 6).indexOf('4.5 lb on hand') > -1, true);
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'scaled-recipe-2026-11-04.txt'), 'utf8');
  const parsedWeek = recipe.parseScaledRecipes(text);
  parsedWeek.purchases.filter(function (row) { return row.pounds > 0 && row.pounds <= 2; }).forEach(function (row) {
    const item = topSpice(row.name);
    if (!item) return;
    const shelf = String(item.label || '');
    if (!/saute line|spice rack/i.test(shelf)) return;
    const need = { quantity: row.pounds, unit: 'lb', source: 'recipe' };
    const unit = order.canonUnit(order.resolvedCountUnit(item));
    let covered = order.needInCountUnit(row.pounds, 'lb', unit, null, item.lbPerUnit, item);
    if (order.isPieceCountUnit(unit)) {
      const piece = order.packAmount(item.pack);
      covered = Math.ceil(row.pounds / (piece.each / 16));
    }
    assert.equal(order.orderCases(item, need, covered), 0, item.itemNumber + ' ' + item.name + ' still orders with ' + covered + ' on hand');
  });
  assert.equal(topSpice('Seeds, chia seeds, dried').itemNumber, '137394');
  assert.equal(topSpice('Spices, rosemary, dried').itemNumber, '774187');
  assert.equal(topSpice('Spices, cinnamon, ground').itemNumber, '774038');
  assert.equal(topSpice('Spices, parsley, dried').itemNumber, '774994');
  assert.equal(topSpice('Italian Parsley').itemNumber, '160016');
  assert.notEqual((topSpice('Peppers, bell, sweet, red, raw') || {}).itemNumber, '128173');
  assert.notEqual((topSpice('Oil, sesame, salad or cooking') || {}).itemNumber, '101922');
  assert.equal(order.orderNeed(pecan, { recipe: { quantity: 5, unit: 'lb' }, standingPar: 9 }).source, 'recipe');
  assert.equal(order.orderNeed(sticker, { standingPar: 2, countUnit: 'each' }).source, 'standing par');
  const page = fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8');
  assert.equal(page.includes("prompt('Standing par"), false);
  assert.equal(page.includes('data-par='), true);
  assert.equal(page.includes('stays food'), false);
  assert.equal(page.includes('data-order-role'), true);
  const db = store.createInventoryDb({ storage: { getItem: function () { return null; }, setItem: function () {} } });
  await storage.setPar(db, 'colonnade', pecan.id, { value: 2, unit: 'each' });
  assert.equal((await db.ref('staging_zedops_pars/colonnade/bek__122588/value').once('value')).val(), 2);
  assert.equal((await db.ref('staging_zedops_pars/colonnade/bek__122588').once('value')).val().unit, 'each');
  const orderLines = page.slice(page.indexOf('function bekOrderLines'), page.indexOf("getElementById('pdfOrder')"));
  assert.equal(orderLines.includes('meal_container'), false);
});

test('food need ignores the BEK par and supplies keep the standing par', () => {
  const asparagus = { id: 'bek__179416', name: 'Asparagus Jumbo', label: 'Produce', pack: '11 / 1 LB', countUnit: 'lb', guidePar: 20, tempZone: 'Refrigeration' };
  const film = { id: 'michael_fleming__film', name: 'Film', kind: 'vendor_check', countUnit: 'case', guidePar: 4 };
  const noRecipe = order.orderNeed(asparagus, { recipe: null, standingPar: 9 });
  assert.equal(noRecipe.quantity, 0);
  assert.equal(noRecipe.source, 'recipe');
  assert.equal(order.casesToOrder(noRecipe.quantity, 0, 11), 0);
  const fromRecipe = order.orderNeed(asparagus, { recipe: { quantity: 31.2, unit: 'lb' }, standingPar: 9 });
  assert.equal(fromRecipe.quantity, 31.2);
  assert.equal(fromRecipe.source, 'recipe');
  assert.equal(order.casesToOrder(fromRecipe.quantity, 0, order.packAmount(asparagus.pack).perCase), 3);
  const supply = order.orderNeed(film, { recipe: { quantity: 50, unit: 'lb' }, standingPar: 2, countUnit: 'case' });
  assert.equal(supply.quantity, 2);
  assert.equal(supply.source, 'standing par');
  const unset = order.orderNeed(film, { standingPar: 0, countUnit: 'case' });
  assert.equal(unset.quantity, 0);
  assert.equal(unset.source, 'standing par');
  const catalog = require('./bek.js').buildCatalog(require('./seed.json'));
  const stored = catalog.items.bek__106810;
  assert.equal(stored.guidePar, 7);
  assert.equal(order.isFoodItem(stored), true);
  assert.equal(order.orderNeed(stored, { recipe: null, standingPar: stored.guidePar }).quantity, 0);
  const page = fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8');
  const parFn = page.slice(page.indexOf('function parOf'), page.indexOf('function recipeNeed'));
  assert.equal(parFn.includes('guidePar'), false);
  assert.equal(page.includes('standing par'), true);
  assert.equal(page.includes('function bekOrderLines'), true);
  assert.equal(page.includes('needLabel(needFor'), true);
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

test('a single approve writes once, and a listener cannot approve again', async () => {
  assert.equal(order.recipeWeek('2026-11-04'), '2026-11-04');
  assert.equal(order.recipeWeek('2026-11-11'), '2026-11-11');
  assert.equal(order.recipeWeek('2026-11-03'), '2026-11-11');
  const purchases = parsed.purchases.map(function (row, index) {
    const copy = Object.assign({}, row);
    copy.matchSaved = true;
    if (index === 0) {
      copy.hideMode = 'ignore';
      copy.catalogId = 'bek__meal';
    } else if (index % 11 === 0) copy.catalogId = '';
    else copy.catalogId = 'bek__654028';
    return copy;
  });
  const cheddar = purchases.find(function (row) { return row.key === 'cheddar_monterey_jack_cheese'; });
  assert.ok(cheddar);
  cheddar.matchSaved = false;
  cheddar.catalogId = 'bek__152510';
  cheddar.hideMode = '';
  const pageState = { approvingRecipe: false, pendingRecipe: { cookDate: '2026-11-04', purchases: purchases } };
  const pending = order.claimApproval(pageState);
  assert.equal(order.claimApproval(pageState), null);
  const plan = order.planRecipeApproval(pending.purchases, order.recipeWeek(pending.cookDate));
  const ordered = purchases.filter(function (row) { return row.matchSaved === true && row.hideMode !== 'ignore' && row.catalogId; });
  assert.equal(Object.keys(plan.lines).length, ordered.length);
  assert.equal(plan.lines[purchases[0].key], undefined);
  assert.equal(plan.matches[purchases[0].key].hideMode, 'ignore');
  assert.equal(plan.matches[purchases[0].key].catalogId, '');
  assert.equal(plan.matches[cheddar.key], undefined);
  assert.equal(plan.lines[cheddar.key], undefined);
  const kept = purchases.find(function (row) { return row.catalogId === 'bek__654028' && row.hideMode !== 'ignore'; });
  assert.equal(plan.lines[kept.key].catalogId, 'bek__654028');
  assert.equal(plan.lines[kept.key].pounds, kept.pounds);

  const db = store.createInventoryDb({ storage: { getItem: function () { return null; }, setItem: function () {} } });
  await db.ref('staging_zedops_recipe/2026-11-04/stale_line').set({ name: 'Stale', pounds: 9, catalogId: 'bek__old' });
  await db.ref('staging_zedops_recipe/2026-11-10/keep_me').set({ name: 'Other week', pounds: 1, catalogId: 'bek__1' });
  await db.ref('staging_zedops_ingredient_map/already_remembered').set({ name: 'Already', catalogId: 'bek__9', hideMode: '' });
  let updates = 0;
  let sets = 0;
  const realRef = db.ref.bind(db);
  db.ref = function (path) {
    const api = realRef(path);
    const update = api.update.bind(api);
    const set = api.set.bind(api);
    api.update = function (map) {
      updates += 1;
      return update(map).then(function () {
        if (order.claimApproval(pageState)) throw new Error('a listener started another approve');
      });
    };
    api.set = function (value) {
      sets += 1;
      return set(value);
    };
    return api;
  };
  const started = Date.now();
  await storage.saveRecipeApproval(db, plan);
  assert.ok(Date.now() - started < 1000);
  assert.equal(updates, 1);
  assert.equal(sets, 0);
  const week = (await realRef('staging_zedops_recipe/2026-11-04').once('value')).val();
  assert.equal(week.stale_line, undefined);
  assert.equal(Object.keys(week).length, ordered.length);
  assert.equal((await realRef('staging_zedops_recipe/2026-11-10/keep_me/name').once('value')).val(), 'Other week');
  assert.equal((await realRef('staging_zedops_ingredient_map/already_remembered/catalogId').once('value')).val(), 'bek__9');
  assert.equal((await realRef('staging_zedops_ingredient_map/' + purchases[0].key + '/hideMode').once('value')).val(), 'ignore');
  assert.equal((await realRef('staging_zedops_ingredient_map/cheddar_monterey_jack_cheese').once('value')).val(), null);
  assert.equal((await realRef('staging_zedops_ingredient_map/' + kept.key + '/catalogId').once('value')).val(), 'bek__654028');
  pageState.approvingRecipe = false;
  pageState.pendingRecipe = { cookDate: '2026-11-04', purchases: purchases };
  const again = order.claimApproval(pageState);
  await storage.saveRecipeApproval(db, order.planRecipeApproval(again.purchases, '2026-11-04'));
  assert.equal(updates, 2);
  assert.equal(Object.keys((await realRef('staging_zedops_recipe/2026-11-04').once('value')).val()).length, ordered.length);
  assert.equal((await realRef('staging_zedops_ingredient_map/cheddar_monterey_jack_cheese').once('value')).val(), null);
  const page = fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8');
  assert.equal(page.includes('alert('), false);
  assert.equal(page.includes('window.confirm('), true);
  const approve = page.slice(page.indexOf('function approveRecipe'), page.indexOf('function onRecipeFile'));
  assert.equal((approve.match(/saveRecipeApproval/g) || []).length, 1);
  assert.equal(approve.includes('setRecipeLine'), false);
  const render = page.slice(page.indexOf('function render('), page.indexOf('function renderStore'));
  const reload = page.slice(page.indexOf('function reload('), page.indexOf('function fillStores'));
  assert.equal(render.includes('saveRecipeApproval') || render.includes('.update(') || render.includes('.set('), false);
  assert.equal(reload.includes('saveRecipeApproval') || reload.includes('.set('), false);
});

test('a suggestion is not saved, and cheddar cheese is not offered as feta', () => {
  const cheeses = [
    { id: 'bek__152510', itemNumber: '152510', name: 'Cheese Feta Crumbles', brand: 'Kronos' },
    { id: 'bek__104973', itemNumber: '104973', name: 'Cheese Cheddar Jack Shrd Fancy', brand: 'Masters Gallery' },
    { id: 'bek__129831', itemNumber: '129831', name: 'Salt Wtr Softener Crystals', brand: '' }
  ];
  assert.equal(order.filterCatalog('Cheddar & Monterey Jack Cheese', cheeses, { solidOnly: true }).length, 0);
  assert.equal(order.filterCatalog('Glenview Farms Mild Cheddar & Monterey Jack Cheese Blend', cheeses, { solidOnly: true }).length, 0);
  assert.equal(order.filterCatalog('cheese', cheeses)[0].itemNumber, '104973');
  assert.equal(order.filterCatalog('Cheese, feta', cheeses, { solidOnly: true })[0].itemNumber, '152510');
  assert.equal(order.filterCatalog('feta', cheeses)[0].itemNumber, '152510');
  const suggested = {
    key: 'cheddar_monterey_jack_cheese', name: 'Cheddar & Monterey Jack Cheese', pounds: 16.4,
    catalogId: 'bek__152510', matchSaved: false, eachFactor: ''
  };
  const confirmed = {
    key: 'cheese_feta', name: 'Cheese, feta', pounds: 1,
    catalogId: 'bek__152510', matchSaved: true, eachFactor: ''
  };
  const plan = order.planRecipeApproval([suggested, confirmed], '2026-11-11');
  assert.equal(plan.matches[suggested.key], undefined);
  assert.equal(plan.lines[suggested.key], undefined);
  assert.equal(plan.matches[confirmed.key].catalogId, 'bek__152510');
  assert.equal(plan.lines[confirmed.key].pounds, 1);
  const page = fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8');
  const save = page.slice(page.indexOf('function saveMatch'), page.indexOf('function approveBlockMessage'));
  assert.equal(save.includes('opts.confirm'), true);
  assert.equal(save.includes('row.matchSaved'), true);
  assert.equal(save.includes('row.key'), true);
  const factor = page.slice(page.indexOf("getAttribute('data-factor')"), page.indexOf("document.addEventListener('click'"));
  assert.equal(factor.includes('current.key !== factorKey'), true);
  assert.equal(factor.includes('matchSaved'), true);
  const hide = page.slice(page.indexOf("getAttribute('data-apply-hide')"), page.indexOf("getAttribute('data-unhide-row')"));
  assert.equal(hide.includes('A suggestion is not saved'), true);
  assert.equal(page.includes('Approve does not save suggestions'), true);
});

test('sriracha and cholula packets are supplies counted by the case', () => {
  const order = require('./order-math.js');
  const bek = require('./bek.js');
  const catalog = bek.buildCatalog(require('./seed.json')).items;
  const sriracha = catalog.bek__133525;
  const cholula = catalog.bek__139893;
  assert.equal(sriracha.pack, '500 / 0.25 OZ');
  assert.equal(cholula.pack, '200 / 0.25 OZ');
  assert.equal(order.isPortionPacket(sriracha), true);
  assert.equal(order.isPortionPacket(cholula), true);
  assert.equal(order.isFoodItem(sriracha), false);
  assert.equal(order.isFoodItem(cholula), false);
  assert.equal(order.isFoodItem(Object.assign({}, sriracha, { orderRole: 'food' })), true);
  assert.equal(order.resolvedCountUnit(sriracha), 'case');
  assert.equal(order.resolvedCountUnit(cholula), 'case');
  assert.equal(order.piecesPerCase(sriracha), 500);
  assert.equal(order.piecesPerCase(cholula), 200);
  const par = order.orderNeed(sriracha, { standingPar: 1, countUnit: 'case' });
  assert.equal(par.source, 'standing par');
  assert.equal(par.quantity, 1);
  assert.deepEqual(order.orderResult(sriracha, par, 0), { amount: 1, unit: 'cs' });
  assert.deepEqual(order.orderResult(sriracha, par, 0.5), { amount: 1, unit: 'cs' });
  assert.deepEqual(order.orderResult(cholula, order.orderNeed(cholula, { standingPar: 1, countUnit: 'case' }), 1), { amount: 0, unit: 'cs' });
  const fromCook = order.orderNeed(sriracha, { cookList: { quantity: 600, unit: 'each' }, standingPar: 1 });
  assert.equal(fromCook.source, 'cook list');
  assert.deepEqual(order.orderResult(sriracha, fromCook, 1), { amount: 1, unit: 'cs' });
  const page = fs.readFileSync(path.join(__dirname, 'weekly-page.js'), 'utf8');
  const parFn = page.slice(page.indexOf('function parOf'), page.indexOf('function recipeNeed'));
  assert.equal(parFn.includes('isPortionPacket'), true);
  assert.equal(parFn.includes('guidePar'), false);
});
