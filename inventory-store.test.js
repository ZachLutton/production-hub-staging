const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const z = require('./inventory-store.js');

function memoryStorage() {
  const bag = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(bag, k) ? bag[k] : null; },
    setItem: function (k, v) { bag[k] = String(v); }
  };
}

test('local store updates nested counts, transactions, and push logs', async () => {
  let now = 1000;
  const db = z.createInventoryDb({ storage: memoryStorage(), now: function () { return now++; } });
  const inv = db.ref('staging_inv_inventory');
  await inv.update({ 'Picadillo/10-16/colonnade': 4, 'Picadillo/10-25/colonnade': 8 });
  const snap = await inv.once('value');
  assert.equal(snap.val().Picadillo['10-16'].colonnade, 4);

  await inv.child('Picadillo/10-16/colonnade').transaction(function (current) {
    const next = (current || 0) - 10;
    return next < 0 ? 0 : next;
  });
  assert.equal((await inv.child('Picadillo/10-16/colonnade').once('value')).val(), 0);

  const transfers = db.ref('staging_inv_transfers');
  await transfers.push({ kind: 'transfer', totalUnits: 2, timestamp: db.ServerValue.TIMESTAMP });
  now = 5000;
  await transfers.push({ kind: 'split', totalUnits: 9, timestamp: db.ServerValue.TIMESTAMP });
  const recent = await transfers.orderByChild('timestamp').limitToLast(1).once('value');
  const rows = [];
  recent.forEach(function (child) { rows.push(child.val()); });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'split');
  assert.equal(rows[0].timestamp, 5000);
});

test('local store persists and reloads without a network', async () => {
  const storage = memoryStorage();
  const first = z.createInventoryDb({ storage: storage, storageKey: 'zedops_staging_inv_local_v1' });
  await first.ref('staging_inv_barcodes').set({ '012345678905': { dishName: 'Orange Chicken' } });
  const second = z.createInventoryDb({ storage: storage, storageKey: 'zedops_staging_inv_local_v1' });
  const snap = await second.ref('staging_inv_barcodes').once('value');
  assert.equal(snap.val()['012345678905'].dishName, 'Orange Chicken');
  const exported = second.exportAll();
  await second.reset();
  assert.equal((await second.ref('staging_inv_barcodes').once('value')).val(), null);
  await second.importAll(exported);
  assert.equal((await second.ref('staging_inv_barcodes/012345678905/dishName').once('value')).val(), 'Orange Chicken');

  await second.ref('staging_inv_barcodes/012345678905').remove();
  assert.equal((await second.ref('staging_inv_barcodes/012345678905').once('value')).val(), null);

  const seen = [];
  const unsub = second.ref('staging_inv_barcodes').on('value', function (snap) { seen.push(snap.val()); });
  second.ref('staging_inv_barcodes').off('value', unsub);
  await second.ref('staging_inv_barcodes').set({ keep: true });
  assert.equal(seen.length, 1);

  await second.ref('staging_history').set({ '2026-01-02': { weekLabel: 'older' }, '2026-03-01': { weekLabel: 'newer' } });
  const listed = await second.ref('staging_history').orderByKey().once('value');
  assert.deepEqual(Object.keys(listed.val()), ['2026-01-02', '2026-03-01']);
  let fromCallback = null;
  await new Promise(function (resolve) {
    second.ref('staging_history').orderByKey().once('value', function (snap) {
      fromCallback = Object.keys(snap.val());
      resolve();
    });
  });
  assert.deepEqual(fromCallback, ['2026-01-02', '2026-03-01']);
});

test('inventory code does not contain the live Firebase project id', () => {
  const liveId = ['zedrics', 'production-hub'].join('-');
  ['inventory.html', 'inventory-features.js', 'inventory-store.js', 'inventory-remote.js', 'firebase-config.js', 'split.js'].forEach(file => {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.equal(text.includes(liveId), false, file);
    assert.equal(text.includes('dishLibrary'), false, file);
    assert.equal(text.includes('staging_productionData'), false, file);
  });
  const html = fs.readFileSync(path.join(__dirname, 'inventory.html'), 'utf8');
  const cfg = fs.readFileSync(path.join(__dirname, 'firebase-config.js'), 'utf8');
  assert.equal(html.includes('createInventoryDb'), true);
  assert.equal(html.includes('HubAuth.signInWithPin'), true);
  assert.equal(html.includes('HubAuth.restore'), true);
  assert.equal(html.includes('firebase-auth-compat.js'), true);
  assert.equal(html.includes('TEAM_PIN'), false);
  assert.equal(html.includes('ADMIN_PIN'), false);
  assert.equal(html.includes("db.ref('staging_inventory"), false);
  assert.equal(html.includes('Beef Taco Skillet'), true);
  assert.equal(html.includes("skipList: ['Beef Taco Skillet', 'Orange Chicken']"), false);
  assert.match(cfg, /projectId:\s*"zedops-staging"/);
});

test('empty config stays local and a live project config is refused', async () => {
  const remote = require('./inventory-remote.js');
  assert.equal(remote.classifyFirebaseConfig({ projectId: '', databaseURL: '' }).mode, 'local');
  const live = {
    projectId: ['zedrics', 'production-hub'].join('-'),
    databaseURL: 'https://' + ['zedrics', 'production-hub'].join('-') + '-default-rtdb.firebaseio.com'
  };
  assert.equal(remote.classifyFirebaseConfig(live).reason, 'live-project-blocked');
  let loaded = false;
  const blocked = await remote.openDatabase(live, {
    createLocal: function () { return { ServerValue: { TIMESTAMP: 1 }, ref: function () { return {}; } }; },
    loadSdk: function () { loaded = true; return Promise.resolve(); }
  });
  assert.equal(blocked.mode, 'blocked');
  assert.equal(blocked.db, null);
  assert.equal(loaded, false);
  const opened = await remote.openDatabase({
    projectId: 'zedops-staging-example',
    databaseURL: 'https://zedops-staging-example.firebaseio.com'
  }, {
    createLocal: function () { return { ServerValue: {} }; },
    loadSdk: function () {
      return Promise.resolve({
        apps: [],
        initializeApp: function () { this.apps.push({}); },
        database: function () { return { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } }; }
      });
    }
  });
  assert.equal(opened.mode, 'remote');
  assert.equal(opened.projectId, 'zedops-staging-example');
});

test('the working tree has no stored team or admin PIN and no derived password', () => {
  const skip = new Set(['node_modules', '.git']);
  const hits = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|html|md|json|yml|yaml|txt|css)$/.test(name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (/(?:const|let|var)\s+(?:TEAM_PIN|ADMIN_PIN)\b/.test(text)) hits.push(path.relative(__dirname, full) + ':pin-constant');
      if (/zph-(?:team|admin)-\d/.test(text)) hits.push(path.relative(__dirname, full) + ':derived-password');
    }
  }
  walk(__dirname);
  assert.deepEqual(hits, []);
});
