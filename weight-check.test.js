const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const w = require('./weight-check.js');
const store = require('./weight-check-store.js');

test('pass range is target plus or minus the tolerance', () => {
  assert.equal(w.DEFAULT_TOLERANCE, 20);
  const range = w.passRange(340, 20);
  assert.deepEqual({ low: range.low, high: range.high }, { low: 320, high: 360 });
  assert.equal(w.judge(320, 340, 20).result, 'pass');
  assert.equal(w.judge(360, 340, 20).result, 'pass');
  assert.equal(w.judge(319, 340, 20).result, 'fail');
  assert.equal(w.judge(361, 340, 20).result, 'fail');
  assert.equal(w.judge(330, 340, 5).result, 'fail');
  assert.equal(w.judge(340, 340, 0).result, 'pass');
});

test('a label serving size can be typed as grams or as the label text', () => {
  assert.equal(w.parseServingSize('340'), 340);
  assert.equal(w.parseServingSize('Serving size (340g)'), 340);
  assert.equal(w.parseServingSize('serving size (340.4g)'), 340);
  assert.equal(w.parseServingSize('Blackened Chicken Alfredo'), null);
});

test('the paper sheet follows the plating sequence and names both checks', () => {
  const day = {
    Queue: { dishes: [{ name: 'Still in the queue', ordered: 10 }] },
    'Station 1': { dishes: [{ name: 'Blackened Chicken Alfredo Penne (3)', ordered: 16 }] },
    'Station 2': { dishes: [{ name: 'Greek Chicken Bowl', ordered: 24 }] }
  };
  const sequence = w.platingSequence(day);
  assert.deepEqual(sequence.map(row => row.name), [
    'Blackened Chicken Alfredo Penne (3)',
    'Greek Chicken Bowl'
  ]);
  const blocks = w.sheetBlocks(sequence, {
    'Blackened Chicken Alfredo Penne (3)': { target: 340, tolerance: 20 }
  });
  assert.equal(blocks[0].low, 320);
  assert.equal(blocks[0].high, 360);
  assert.equal(blocks[0].checks[0].label, '8th plate on the first tray');
  assert.equal(blocks[0].checks[1].label, 'a plate from a middle tray');
  assert.equal(blocks[1].target, null);
  const html = w.printDocument('Tuesday 5/5', blocks);
  assert.equal(html.includes(w.RULE), true);
  assert.equal(html.includes('Weight (g) ________'), true);
  assert.equal(html.includes('Plater ________'), true);
  assert.equal(html.includes('Checker ________'), true);
  assert.equal(html.includes('Still in the queue'), false);
  const queueOnly = w.platingSequence({ Queue: { dishes: [{ name: 'Picadillo', ordered: 8 }] } });
  assert.equal(queueOnly[0].name, 'Picadillo');
});

test('an entered weight is marked pass or miss, including an optional recheck', () => {
  const targets = { 'Blackened Chicken Alfredo Penne (3)': { target: 340, tolerance: 20 } };
  const saved = w.recordCheck({
    day: 'Tuesday 5/5',
    dish: 'Blackened Chicken Alfredo Penne (3)',
    check: 2,
    weight: 300,
    plater: 'AL',
    checker: 'HK',
    recheck: 345
  }, targets);
  assert.equal(saved.ok, true);
  assert.equal(saved.entry.result, 'fail');
  assert.equal(saved.entry.recheckResult, 'pass');
  assert.equal(saved.entry.low, 320);
  const missing = w.recordCheck({ dish: 'Greek Chicken Bowl', check: 1, weight: 300, plater: 'AL', checker: 'HK' }, {});
  assert.equal(missing.ok, false);
});

test('misses are summarized by plater and by dish', () => {
  const summary = w.missSummary([
    { dish: 'Alfredo', result: 'fail', recheckResult: 'pass', plater: 'AL' },
    { dish: 'Alfredo', result: 'pass', recheckResult: null, plater: 'AL' },
    { dish: 'Picadillo', result: 'fail', recheckResult: 'fail', plater: 'MJ' }
  ]);
  assert.deepEqual(summary.byPlater, [
    { name: 'MJ', misses: 2 },
    { name: 'AL', misses: 1 }
  ]);
  assert.equal(summary.byDish.find(row => row.name === 'Alfredo').misses, 1);
  assert.equal(summary.byDish.find(row => row.name === 'Picadillo').misses, 2);
  const html = w.reportHtml({ checks: [{ day: 'Tuesday 5/5', dish: 'Alfredo', check: 1, weight: 300, low: 320, high: 360, result: 'fail', plater: 'AL', checker: 'HK', recheck: null, recheckResult: null }] });
  assert.match(html, /weight-miss/);
  assert.match(html, /Miss/);
});

test('staging now has the live hub pages, and ZedOps keeps inventory.html', () => {
  const liveId = ['zedrics', 'production-hub'].join('-');
  const monthly = fs.readFileSync(path.join(__dirname, 'monthly-inventory.html'), 'utf8');
  const weekly = fs.readFileSync(path.join(__dirname, 'weekly-order.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
  const zedops = fs.readFileSync(path.join(__dirname, 'inventory.html'), 'utf8');
  const hub = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.equal(monthly.includes("db.ref('inventory/"), false);
  assert.equal(monthly.includes("staging_inventory/"), true);
  assert.equal(weekly.includes("db.ref('weekly_orders/"), false);
  assert.equal(weekly.includes("db.ref('inventory/"), false);
  assert.equal(weekly.includes('staging_weekly_orders/'), true);
  assert.equal(dashboard.includes('monthly-inventory.html'), true);
  assert.equal(dashboard.includes('ZedOps inventory'), true);
  assert.equal(zedops.includes('ZedOps'), true);
  assert.equal(hub.includes("db.ref('staging_productionData')"), true);
  assert.equal(hub.includes("db.ref('productionData')"), false);
  assert.equal(hub.includes('openWeightCheck()'), true);
  ['db-backup.yml', 'rim-reminder.yml', 'rim-summary.yml'].forEach(file => {
    const text = fs.readFileSync(path.join(__dirname, '.github/workflows', file), 'utf8');
    assert.equal(text.includes("github.repository == 'ZachLutton/production-hub'"), true, file);
  });
  const backup = fs.readFileSync(path.join(__dirname, 'scripts/backup-db.js'), 'utf8');
  assert.equal(backup.includes(liveId + '-default-rtdb'), true);
});

test('weight checks stay off the live hub database', async () => {
  const liveId = ['zedrics', 'production-hub'].join('-');
  ['weight-check.js', 'weight-check-store.js', 'weight-check-ui.js'].forEach(file => {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.equal(text.includes(liveId), false, file);
    assert.equal(text.includes('dataRef'), false, file);
    assert.equal(text.includes('historyRef'), false, file);
    assert.equal(text.includes('dishLibraryRef'), false, file);
  });
  const hub = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.equal(hub.includes('openWeightCheck'), true);
  assert.equal(hub.includes("db.ref('staging_weight"), false);
  const memory = { bag: {}, getItem: function (k) { return this.bag[k] || null; }, setItem: function (k, v) { this.bag[k] = v; } };
  const local = store.createLocalStore(memory);
  await local.save({ targets: { Alfredo: { target: 340, tolerance: 20 } }, checks: [] });
  const loaded = await local.load();
  assert.equal(loaded.targets.Alfredo.target, 340);
  const blocked = store.classifyConfig({
    projectId: liveId,
    databaseURL: 'https://' + liveId + '-default-rtdb.firebaseio.com'
  });
  assert.equal(blocked.mode, 'local');
  let named = null;
  const opened = await store.open({
    config: { projectId: 'zedops-staging-example', databaseURL: 'https://zedops-staging-example.firebaseio.com' },
    firebase: {
      apps: [],
      initializeApp: function (cfg, name) {
        named = name;
        const app = { name: name, database: function () { return { ref: function () { return { once: function () { return Promise.resolve({ val: function () { return { targets: {}, checks: [] }; } }); }, set: function (data) { return Promise.resolve(data); } }; } }; } };
        this.apps.push(app);
        return app;
      }
    }
  });
  assert.equal(named, 'zedops-weight');
  assert.equal(opened.mode, 'remote');
});
