const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const boot = require('./staging-boot.js');

const LIVE_ID = ['zedrics', 'production-hub'].join('-');
const PAGES = ['index.html', 'dashboard.html', 'weekly-order.html', 'monthly-inventory.html', 'inventory.html', 'bek-count.html', 'bek-combined.html'];
const RULE_PATHS = [
  'staging_productionData',
  'staging_dishLibrary',
  'staging_history',
  'staging_weight',
  'staging_inventory',
  'staging_weekly_orders',
  'staging_inv_inventory',
  'staging_inv_adjustments',
  'staging_inv_counts',
  'staging_inv_caseConfig',
  'staging_inv_transfers',
  'staging_inv_stockouts',
  'staging_inv_shelfLife',
  'staging_inv_splitConfig',
  'staging_inv_barcodes',
  'staging_inv_skipList',
  'staging_inv_stores',
  'staging_inv_skuMap',
  'staging_inv_mealCosts',
  'staging_zedops_schema',
  'staging_zedops_locations',
  'staging_zedops_catalog',
  'staging_zedops_counts',
  'staging_zedops_pars',
  'staging_zedops_hidden',
  'staging_zedops_drafts',
  'staging_zedops_ingredient_map',
  'staging_zedops_recipe',
  'staging_zedops_plate',
  'staging_zedops_price_approvals'
];

test('empty config stays in the browser and the live project is refused', () => {
  assert.equal(boot.classify({ projectId: '', databaseURL: '' }).mode, 'local');
  const live = {
    projectId: LIVE_ID,
    databaseURL: 'https://' + LIVE_ID + '-default-rtdb.firebaseio.com',
    authDomain: LIVE_ID + '.firebaseapp.com'
  };
  assert.equal(boot.classify(live).mode, 'blocked');
  assert.equal(boot.classify(live).reason, 'live-project-blocked');
  let started = false;
  const blocked = boot.start({
    config: live,
    firebase: { apps: [], initializeApp: function () { started = true; this.apps.push({}); } }
  });
  assert.equal(blocked.mode, 'blocked');
  assert.equal(started, false);

  const local = boot.start({
    config: { projectId: '', databaseURL: '' },
    storageKey: 'zedops_staging_boot_test',
    storage: { getItem: function () { return null; }, setItem: function () {} },
    ZedLocal: require('./inventory-store.js'),
    firebase: { apps: [], initializeApp: function () { started = true; } }
  });
  assert.equal(local.mode, 'local');
  assert.equal(started, false);
  assert.equal(typeof local.db.ref, 'function');
});

test('a staging project is the only config that initializes Firebase', () => {
  let seen = null;
  const opened = boot.start({
    config: {
      apiKey: 'staging-key',
      authDomain: 'zedops-staging-example.firebaseapp.com',
      databaseURL: 'https://zedops-staging-example.firebaseio.com',
      projectId: 'zedops-staging-example'
    },
    firebase: {
      apps: [],
      initializeApp: function (cfg) { seen = cfg; this.apps.push({}); },
      database: function () { return { name: 'staging-db' }; }
    }
  });
  assert.equal(opened.mode, 'remote');
  assert.equal(opened.projectId, 'zedops-staging-example');
  assert.equal(seen.projectId, 'zedops-staging-example');
  assert.equal(opened.db.name, 'staging-db');
});

test('pages read firebase-config.js and do not name the live project', () => {
  PAGES.forEach(function (file) {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.equal(text.includes('firebase-config.js'), true, file);
    assert.equal(text.includes(LIVE_ID), false, file);
    assert.equal(text.includes('AIzaSyDUveUlxrNDIU4yDUpbzjv8-X625S-l0Po'), false, file);
  });
  const cfg = fs.readFileSync(path.join(__dirname, 'firebase-config.js'), 'utf8');
  assert.match(cfg, /ZedOps Staging/);
  assert.match(cfg, /projectId:\s*"zedops-staging"/);
  assert.equal(cfg.includes(LIVE_ID), false);
});

test('staging rules cover every app path and require the two password accounts', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'database.rules.staging.json'), 'utf8')).rules;
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
  const expr = rules.staging_weight['.read'];
  assert.equal(typeof expr, 'string');
  assert.match(expr, /auth != null/);
  assert.match(expr, /sign_in_provider === 'password'/);
  assert.equal(expr.includes('team@' + LIVE_ID + '.firebaseapp.com'), true);
  assert.equal(expr.includes('admin@' + LIVE_ID + '.firebaseapp.com'), true);
  RULE_PATHS.forEach(function (key) {
    assert.equal(rules[key]['.read'], expr, key);
    assert.equal(rules[key]['.write'], expr, key);
    assert.notEqual(rules[key]['.read'], true, key);
  });
  assert.equal(Object.keys(rules).filter(function (key) { return key.charAt(0) !== '.'; }).length, RULE_PATHS.length);
});
