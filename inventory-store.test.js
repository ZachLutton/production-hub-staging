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
});

test('inventory page does not connect to the live Firebase project', () => {
  const html = fs.readFileSync(path.join(__dirname, 'inventory.html'), 'utf8');
  const features = fs.readFileSync(path.join(__dirname, 'inventory-features.js'), 'utf8');
  const combined = html + '\n' + features;
  ['firebaseio.com', 'firebaseapp.com', 'initializeApp', 'gstatic.com/firebasejs', 'dishLibrary', 'signInAnonymously', 'staging_productionData'].forEach(token => {
    assert.equal(combined.includes(token), false, token);
  });
  assert.equal(html.includes('createInventoryDb'), true);
  assert.equal(html.includes('Beef Taco Skillet'), true);
  assert.equal(html.includes("skipList: ['Beef Taco Skillet', 'Orange Chicken']"), false);
});
