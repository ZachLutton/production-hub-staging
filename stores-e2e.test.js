const test = require('node:test');
const assert = require('node:assert/strict');
const split = require('./split.js');
const store = require('./inventory-store.js');

function memoryStorage() {
  const bag = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(bag, k) ? bag[k] : null; },
    setItem: function (k, v) { bag[k] = String(v); }
  };
}

test('adding a third store and a commissary works end to end', async () => {
  let stores = split.normalizeStores(split.DEFAULT_STORES);
  assert.equal(stores.length, 2);

  stores = split.addStore(stores, { name: 'Store 3', hasPickup: true, share: 0 });
  stores = split.addStore(stores, {
    name: 'Commissary',
    isProductionKitchen: true,
    hasPickup: false,
    share: 0,
    backstock: true
  });
  assert.equal(stores.length, 4);
  const third = stores.find(item => item.name === 'Store 3');
  const kitchen = stores.find(item => item.isProductionKitchen);
  assert.ok(third);
  assert.equal(kitchen.name, 'Commissary');
  assert.equal(split.splitTargets(stores).some(item => item.id === kitchen.id), false);

  stores = stores.map(item => {
    if (item.id === stores[0].id) item.share = 50;
    else if (item.id === stores[1].id) item.share = 30;
    else if (item.id === third.id) item.share = 20;
    else item.share = 0;
    return item;
  });
  const hub = stores.find(item => item.isDeliveryHub);
  assert.equal(split.sharesStatus(stores).ok, true);
  assert.equal(split.sharesStatus(stores).sum, 100);

  const locations = split.locationsFor(stores);
  assert.ok(locations.some(loc => loc.id === third.id && loc.kind === 'case'));
  assert.ok(locations.some(loc => loc.id === split.backstockLocationId(kitchen.id) && loc.kind === 'backstock'));
  assert.ok(locations.some(loc => loc.storeId === kitchen.id));

  const row = split.splitDish({
    dish: 'Picadillo',
    plated: 90,
    pickups: { [third.id]: 6 },
    delivery: 6
  }, { stores: stores, stackHeight: 6 });

  assert.equal(split.allocationTotal(row), 90);
  assert.equal(row.allocations.some(item => item.id === kitchen.id), false);
  assert.equal(row.deliveryStoreId, hub.id);
  row.allocations.forEach(slot => {
    assert.ok(slot.total >= 1, slot.id);
    assert.ok(slot.caseQty <= slot.capacity, slot.id);
    assert.equal(slot.caseQty + slot.backstock, slot.total);
  });
  const thirdSlot = row.allocations.find(item => item.id === third.id);
  assert.equal(thirdSlot.prepaid, 6);
  const hubSlot = row.allocations.find(item => item.id === hub.id);
  assert.equal(hubSlot.delivery, 6);

  const db = store.createInventoryDb({ storage: memoryStorage(), now: function () { return 5000; } });
  await db.ref('staging_inv_stores').set(stores);
  const useBy = '10-20';
  const updates = {};
  row.allocations.forEach(slot => {
    updates['picadillo/' + useBy + '/' + slot.id] = slot.caseQty;
    if (slot.backstockId) updates['picadillo/' + useBy + '/' + slot.backstockId] = slot.backstock;
  });
  await db.ref('staging_inv_inventory').update(updates);

  const savedStores = await db.ref('staging_inv_stores').once('value');
  assert.equal(savedStores.val().length, 4);

  const before = await db.ref('staging_inv_inventory').once('value');
  const moved = split.applyTransfer(before.val(), {
    from: third.id,
    to: split.backstockLocationId(kitchen.id),
    today: '2026-10-13',
    lines: [{ dishKey: 'picadillo', name: 'Picadillo', qty: 4 }]
  });
  assert.equal(moved.short, false);
  assert.equal(moved.logItems[0].qty, 4);
  await db.ref('staging_inv_inventory').update(moved.updates);

  const after = await db.ref('staging_inv_inventory/picadillo/' + useBy).once('value');
  const counts = after.val();
  assert.equal(counts[third.id], thirdSlot.caseQty - 4);
  assert.equal(counts[split.backstockLocationId(kitchen.id)], 4);
  assert.equal(counts[hub.id], hubSlot.caseQty);
  assert.equal(Object.keys(counts).some(key => key.indexOf(kitchen.id) === 0), true);
});
