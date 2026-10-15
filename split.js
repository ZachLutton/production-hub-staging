// Split, rebalance, shelf capacity, and transfers for ZedOps inventory.
// Stores come from a config list. This file has no Firebase and no DOM.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedSplit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function defaultDoors(overrides) {
    var doors = ['2', '3', '4', '5', '6'].map(function (id) {
      return { id: id, name: 'Door ' + id, full: 72, half: 36 };
    });
    (overrides || []).forEach(function (extra) {
      doors.forEach(function (door) {
        if (String(door.id) === String(extra.id)) {
          if (extra.full != null) door.full = extra.full;
          if (extra.half != null) door.half = extra.half;
          if (extra.name) door.name = extra.name;
        }
      });
    });
    return doors;
  }

  // Current stores. Add store 3 or a commissary with addStore — do not branch on these ids.
  var DEFAULT_STORES = [
    {
      id: 'colonnade',
      name: 'Colonnade',
      share: 60,
      hasPickup: true,
      isDeliveryHub: false,
      isProductionKitchen: false,
      backstock: true,
      doors: defaultDoors([{ id: '6', full: 48, half: 24 }])
    },
    {
      id: 'rim',
      name: 'Rim',
      share: 40,
      hasPickup: true,
      isDeliveryHub: true,
      isProductionKitchen: false,
      backstock: true,
      doors: defaultDoors()
    }
  ];

  var DEFAULT_CONFIG = {
    stackHeight: 6,
    leaveAtLeast: 5,
    productionMin: 50,
    skipList: ['Beef Taco Skillet']
  };

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function roundToStack(qty, stack) {
    var q = Number(qty) || 0;
    var s = Math.round(Number(stack) || 1);
    if (s <= 1) return Math.max(0, Math.round(q));
    return Math.max(0, Math.round(q / s) * s);
  }

  function normalizeName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function normalizeBarcode(value) {
    return String(value || '').replace(/[\s*]/g, '').trim();
  }

  function slugId(value) {
    var id = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return id || 'store';
  }

  function isSkipped(name, skipList) {
    var n = normalizeName(name);
    if (!n) return false;
    return (skipList || []).some(function (entry) {
      var key = normalizeName(entry);
      if (!key) return false;
      if (key.length < 4) return n === key;
      return n.indexOf(key) !== -1 || key.indexOf(n) !== -1;
    });
  }

  function stackSizeFor(name, config) {
    var cfg = config || DEFAULT_CONFIG;
    var height = cfg.stackHeight != null ? cfg.stackHeight : DEFAULT_CONFIG.stackHeight;
    return Math.max(1, Math.round(Number(height) || DEFAULT_CONFIG.stackHeight));
  }

  function copyDoors(doors) {
    return (doors || []).map(function (door) {
      return {
        id: String(door.id),
        name: door.name || ('Door ' + door.id),
        full: Math.max(0, Math.round(Number(door.full != null ? door.full : 72))),
        half: Math.max(0, Math.round(Number(door.half != null ? door.half : 36)))
      };
    });
  }

  function normalizeStores(input) {
    var raw = input;
    if (raw && !Array.isArray(raw) && typeof raw === 'object') {
      raw = Object.keys(raw).map(function (key) { return raw[key]; }).filter(function (store) {
        return store && typeof store === 'object' && store.id;
      });
    }
    var source = raw && raw.length ? raw : DEFAULT_STORES;
    var list = source.map(function (store) {
      return {
        id: String(store.id),
        name: String(store.name || store.id),
        share: Number(store.share) || 0,
        hasPickup: !!store.hasPickup,
        isDeliveryHub: !!store.isDeliveryHub,
        isProductionKitchen: !!store.isProductionKitchen,
        backstock: store.backstock !== false,
        doors: store.doors && store.doors.length ? copyDoors(store.doors) : defaultDoors()
      };
    });
    var seenHub = false;
    list.forEach(function (store) {
      if (!store.isDeliveryHub) return;
      if (seenHub) store.isDeliveryHub = false;
      else seenHub = true;
    });
    return list;
  }

  function splitTargets(stores) {
    return normalizeStores(stores).filter(function (store) {
      if (store.isProductionKitchen && !(Number(store.share) > 0)) return false;
      return true;
    });
  }

function sharesStatus(stores) {
  var targets = splitTargets(stores);
  var sum = targets.reduce(function (total, store) { return total + (Number(store.share) || 0); }, 0);
  sum = Math.round(sum * 1000) / 1000;
  var missing = targets.filter(function (store) { return !(Number(store.share) > 0); }).map(function (store) { return store.name; });
  return {
    ok: Math.abs(sum - 100) < 0.001 && missing.length === 0,
    sum: sum,
    missing: missing,
    targets: targets
  };
}

  function addStore(stores, draft) {
    var list = normalizeStores(stores);
    var seed = slugId((draft && (draft.id || draft.name)) || 'store');
    var id = seed;
    var n = 2;
    while (list.some(function (store) { return store.id === id; })) {
      id = seed + '-' + n;
      n += 1;
    }
    var kitchen = !!(draft && draft.isProductionKitchen);
    var store = {
      id: id,
      name: String((draft && draft.name) || id).trim() || id,
      share: Number(draft && draft.share) || 0,
      hasPickup: kitchen ? !!(draft && draft.hasPickup) : draft && draft.hasPickup === false ? false : true,
      isDeliveryHub: !!(draft && draft.isDeliveryHub),
      isProductionKitchen: kitchen,
      backstock: !draft || draft.backstock !== false,
      doors: draft && draft.doors && draft.doors.length ? copyDoors(draft.doors) : defaultDoors()
    };
    if (store.isDeliveryHub) list.forEach(function (item) { item.isDeliveryHub = false; });
    list.push(store);
    return normalizeStores(list);
  }

  function backstockLocationId(storeId) {
    return String(storeId) + '_backstock';
  }

  function storeIdFromLocation(locationId) {
    var id = String(locationId || '');
    var suffix = '_backstock';
    if (id.length > suffix.length && id.slice(-suffix.length) === suffix) return id.slice(0, -suffix.length);
    return id;
  }

  function locationsFor(stores) {
    var list = [];
    normalizeStores(stores).forEach(function (store) {
      list.push({ id: store.id, storeId: store.id, kind: 'case', label: store.name + ' case' });
      if (store.backstock) {
        list.push({
          id: backstockLocationId(store.id),
          storeId: store.id,
          kind: 'backstock',
          label: store.name + ' backstock'
        });
      }
    });
    return list;
  }

  function doorsInSection(sectionName) {
    var match = String(sectionName || '').match(/cases?\s+(\d+)(?:\s*-\s*(\d+))?/i);
    if (!match) return [];
    var start = parseInt(match[1], 10);
    var end = match[2] ? parseInt(match[2], 10) : start;
    var doors = [];
    for (var door = start; door <= end; door++) doors.push(String(door));
    return doors;
  }

  function defaultShelfPlan(sections) {
    var byDoor = {};
    Object.keys(sections || {}).forEach(function (section) {
      var doors = doorsInSection(section);
      if (!doors.length) doors = ['other'];
      (sections[section] || []).forEach(function (dish, index) {
        var door = doors[index % doors.length];
        byDoor[door] = byDoor[door] || [];
        byDoor[door].push(dish);
      });
    });
    var plan = {};
    Object.keys(byDoor).forEach(function (door) {
      var list = byDoor[door];
      for (var i = 0; i < list.length; i += 2) {
        if (i + 1 < list.length) {
          plan[list[i]] = { door: door, share: 'half' };
          plan[list[i + 1]] = { door: door, share: 'half' };
        } else {
          plan[list[i]] = { door: door, share: 'full' };
        }
      }
    });
    return plan;
  }

  function shelfSlot(dish, config) {
    var plan = config && config.shelfPlan;
    if (!plan && config && config.sections) plan = defaultShelfPlan(config.sections);
    if (plan && plan[dish]) return plan[dish];
    if (plan) {
      var key = normalizeName(dish);
      var names = Object.keys(plan);
      for (var i = 0; i < names.length; i++) {
        if (normalizeName(names[i]) === key) return plan[names[i]];
      }
    }
    return { door: '3', share: 'half' };
  }

  function shelfCapacity(store, slot) {
    var doorId = slot && slot.door ? String(slot.door) : '3';
    var share = slot && slot.share === 'full' ? 'full' : 'half';
    var doors = (store && store.doors) || [];
    var door = null;
    for (var i = 0; i < doors.length; i++) {
      if (String(doors[i].id) === doorId) door = doors[i];
    }
    var full = door && door.full != null ? door.full : 72;
    var half = door && door.half != null ? door.half : 36;
    return share === 'full' ? full : half;
  }

  function storeById(stores, id) {
    for (var i = 0; i < stores.length; i++) if (stores[i].id === id) return stores[i];
    return null;
  }

  function applyPerDishShares(stores, perDish) {
    if (!perDish || typeof perDish !== 'object' || Array.isArray(perDish)) return stores;
    return stores.map(function (store) {
      if (perDish[store.id] == null) return store;
      var next = clone(store);
      next.share = Number(perDish[store.id]) || 0;
      return next;
    });
  }

  function fractionsFor(targets) {
    var sum = targets.reduce(function (total, store) { return total + (Number(store.share) || 0); }, 0);
    if (sum <= 0) return targets.map(function () { return 1 / targets.length; });
    return targets.map(function (store) { return (Number(store.share) || 0) / sum; });
  }

  // Pickups stay at the store on the order. Delivery goes to the store flagged
  // as the delivery hub. Walk-in plates follow each store's percent. Percents
  // for stores in the split should add up to 100. Case quantities never exceed
  // that store's shelf for the dish; the rest is backstock. Every split store
  // gets the dish when uncommitted plates allow it.
  function splitDish(row, config) {
    var cfg = config || {};
    var name = row && row.dish ? String(row.dish) : '';
    var stackSize = stackSizeFor(name, cfg);
    var plated = Math.max(0, Math.round(Number(row && row.plated) || 0));
    var skipList = cfg.skipList || DEFAULT_CONFIG.skipList;
    var allStores = normalizeStores(cfg.stores || (row && row.stores));
    var perDish = cfg.perDish && cfg.perDish[name];
    if (perDish && typeof perDish === 'object') allStores = applyPerDishShares(allStores, perDish);
    var targets = splitTargets(allStores);
    var hub = null;
    allStores.forEach(function (store) { if (store.isDeliveryHub && !hub) hub = store; });
    var shareInfo = sharesStatus(allStores);
    var warnings = [];
    var slot = shelfSlot(name, cfg);
    var emptyAllocations = targets.map(function (store) {
      return blankAllocation(store, slot);
    });

    if (isSkipped(name, skipList)) {
      return {
        dish: name, skipped: true, plated: plated, stackSize: stackSize,
        delivery: 0, deliveryStoreId: hub ? hub.id : '',
        allocations: emptyAllocations.map(function (slotRow) {
          slotRow.total = 0; slotRow.caseQty = 0; slotRow.backstock = 0;
          return slotRow;
        }),
        warnings: ['On the skip list']
      };
    }

    if (!shareInfo.ok) warnings.push('Store shares add up to ' + shareInfo.sum + '%, not 100%');
    targets.forEach(function (store) {
      if (!(Number(store.share) > 0)) warnings.push(store.name + ' has a 0% share');
    });

    var requestedPickups = {};
    var pickupSource = (row && (row.pickups || row.prepaid)) || {};
    Object.keys(pickupSource).forEach(function (id) {
      requestedPickups[id] = Math.max(0, Math.round(Number(pickupSource[id]) || 0));
    });
    var requestedDelivery = Math.max(0, Math.round(Number(row && row.delivery) || 0));
    var pickupIds = Object.keys(requestedPickups);
    var pickupNeed = pickupIds.reduce(function (sum, id) { return sum + requestedPickups[id]; }, 0);
    var pickups = {};
    var delivery = 0;
    targets.forEach(function (store) { pickups[store.id] = 0; });

    if (pickupNeed > plated) {
      var given = 0;
      pickupIds.forEach(function (id, index) {
        if (!storeById(targets, id)) return;
        var qty = index === pickupIds.length - 1 && given < plated
          ? Math.max(0, Math.min(requestedPickups[id], plated - given))
          : Math.floor(plated * requestedPickups[id] / pickupNeed);
        if (given + qty > plated) qty = plated - given;
        pickups[id] = qty;
        given += qty;
      });
      warnings.push('Plated count does not cover prepaid pickups');
    } else {
      pickupIds.forEach(function (id) {
        if (!storeById(targets, id)) {
          warnings.push('Pickup store is not in the split');
          return;
        }
        pickups[id] = requestedPickups[id];
      });
      var pickupSum = targets.reduce(function (sum, store) { return sum + (pickups[store.id] || 0); }, 0);
      var afterPickup = plated - pickupSum;
      delivery = Math.min(requestedDelivery, afterPickup);
      if (delivery < requestedDelivery) warnings.push('Plated count does not cover delivery orders');
      if (delivery > 0 && !hub) {
        warnings.push('No delivery hub is set, so delivery orders were split with walk-in');
        delivery = 0;
      } else if (delivery > 0 && !storeById(targets, hub.id)) {
        warnings.push('Delivery hub is not in the split, so delivery orders were split with walk-in');
        delivery = 0;
      }
    }

    var committed = targets.reduce(function (sum, store) { return sum + (pickups[store.id] || 0); }, 0) + delivery;
    var rest = Math.max(0, plated - committed);
    var fractions = fractionsFor(targets);
    var walk = {};
    var left = rest;
    targets.forEach(function (store, index) {
      if (index === targets.length - 1) {
        walk[store.id] = left;
        return;
      }
      var rounded = roundToStack(rest * fractions[index], stackSize);
      if (rounded > left) rounded = Math.floor(left / stackSize) * stackSize;
      walk[store.id] = rounded;
      left -= rounded;
    });

    var totals = {};
    targets.forEach(function (store) {
      var hubQty = hub && store.id === hub.id ? delivery : 0;
      totals[store.id] = (pickups[store.id] || 0) + (walk[store.id] || 0) + hubQty;
    });

    if (plated >= targets.length) {
      var guard = 0;
      var stuck = false;
      while (guard < 50 && !stuck) {
        guard += 1;
        var empty = null;
        targets.forEach(function (store) { if (!empty && totals[store.id] === 0) empty = store; });
        if (!empty) break;
        var donor = null;
        targets.forEach(function (store) {
          if (donor || store.id === empty.id) return;
          if ((walk[store.id] || 0) > 0 && totals[store.id] > 1) donor = store;
        });
        if (!donor) { stuck = true; break; }
        walk[donor.id] -= 1;
        walk[empty.id] = (walk[empty.id] || 0) + 1;
        totals[donor.id] -= 1;
        totals[empty.id] += 1;
      }
      if (stuck) warnings.push('Not enough uncommitted plates for every store');
    }

    var allocations = targets.map(function (store) {
      var cap = shelfCapacity(store, slot);
      var total = totals[store.id] || 0;
      var caseQty = Math.min(total, cap);
      var back = total - caseQty;
      if (back > 0) {
        warnings.push(store.name + ' case holds ' + cap + ' (door ' + slot.door + ' ' + slot.share + ' shelf). ' + back + ' go to backstock');
      }
      return {
        id: store.id,
        name: store.name,
        share: Number(store.share) || 0,
        total: total,
        caseQty: caseQty,
        backstock: back,
        prepaid: pickups[store.id] || 0,
        walkIn: walk[store.id] || 0,
        delivery: hub && store.id === hub.id ? delivery : 0,
        capacity: cap,
        door: String(slot.door),
        shelf: slot.share,
        backstockId: store.backstock ? backstockLocationId(store.id) : ''
      };
    });

    var allocated = allocations.reduce(function (sum, item) { return sum + item.total; }, 0);
    if (allocated !== plated) warnings.push('Split does not add up to plated count');

    return {
      dish: name,
      skipped: false,
      plated: plated,
      stackSize: stackSize,
      delivery: delivery,
      deliveryStoreId: hub ? hub.id : '',
      allocations: allocations,
      warnings: warnings
    };
  }

  function blankAllocation(store, slot) {
    return {
      id: store.id,
      name: store.name,
      share: Number(store.share) || 0,
      total: 0,
      caseQty: 0,
      backstock: 0,
      prepaid: 0,
      walkIn: 0,
      delivery: 0,
      capacity: shelfCapacity(store, slot),
      door: String(slot.door || '3'),
      shelf: slot.share || 'half',
      backstockId: store.backstock ? backstockLocationId(store.id) : ''
    };
  }

  function splitBatch(rows, config) {
    return (rows || []).map(function (row) { return splitDish(row, config); });
  }

  function allocationTotal(result) {
    return (result && result.allocations || []).reduce(function (sum, item) { return sum + item.total; }, 0);
  }

  function storeTransferQty(fromQty, orangeStar, leaveAtLeast) {
    var qty = Math.max(0, Math.round(Number(fromQty) || 0));
    var star = Math.max(0, Math.round(Number(orangeStar) || 0));
    var leave = Math.max(0, Math.round(Number(leaveAtLeast) || 0));
    if (qty >= leave && leave > 0) {
      return { qty: Math.min(Math.floor(qty / 2), qty - leave), reason: 'surplus' };
    }
    if (star > 0 && qty > 1) {
      return { qty: Math.min(star, Math.floor(qty / 2), qty - 1), reason: 'orange-star' };
    }
    return { qty: 0, reason: '' };
  }

  function rebalanceSuggestions(input) {
    var dishes = (input && input.dishes) || [];
    var leaveAtLeast = input && input.leaveAtLeast != null ? input.leaveAtLeast : DEFAULT_CONFIG.leaveAtLeast;
    var skipList = (input && input.skipList) || [];
    var stores = normalizeStores(input && input.stores);
    var suggestions = [];

    dishes.forEach(function (dish) {
      var name = dish.name || dish.dish;
      if (!name || isSkipped(name, skipList)) return;
      var onHand = dish.onHand || {};
      var back = dish.backstock || {};
      var stars = dish.orangeStar || {};
      var capacity = dish.capacity || null;

      stores.forEach(function (store) {
        var onCase = Math.max(0, Math.round(Number(onHand[store.id]) || 0));
        var cooler = Math.max(0, Math.round(Number(back[store.id]) || 0));
        if (onCase > 0 || cooler <= 0 || !store.backstock) return;
        var room = capacity && capacity[store.id] != null ? Math.max(0, Math.round(Number(capacity[store.id])) - onCase) : cooler;
        var pull = Math.min(cooler, room);
        if (pull > 0) {
          suggestions.push({
            name: name,
            from: backstockLocationId(store.id),
            to: store.id,
            qty: pull,
            reason: 'backstock',
            note: 'Case is empty. Pull from this store\'s backstock cooler, oldest first. Edit the quantity before logging.'
          });
        }
      });

      stores.forEach(function (donor) {
        var fromQty = Math.max(0, Math.round(Number(onHand[donor.id]) || 0));
        var move = storeTransferQty(fromQty, stars[donor.id], leaveAtLeast);
        var left = move.qty;
        if (left < 1) return;
        stores.forEach(function (dest) {
          if (left < 1 || dest.id === donor.id) return;
          if (Math.round(Number(onHand[dest.id]) || 0) > 0) return;
          var room = capacity && capacity[dest.id] != null ? Math.max(0, Math.round(Number(capacity[dest.id]))) : left;
          var toCase = Math.min(left, room);
          if (toCase > 0) {
            suggestions.push({
              name: name,
              from: donor.id,
              to: dest.id,
              qty: toCase,
              reason: move.reason,
              note: move.reason === 'orange-star'
                ? 'Another store is out and this store has orange-star meals. Move oldest first.'
                : 'Out at one store and ' + leaveAtLeast + ' or more at another. Move half, leave at least ' + leaveAtLeast + ', oldest first.'
            });
            left -= toCase;
          }
          if (left > 0 && capacity && capacity[dest.id] != null && dest.backstock) {
            suggestions.push({
              name: name,
              from: donor.id,
              to: backstockLocationId(dest.id),
              qty: left,
              reason: 'overflow',
              note: dest.name + ' case is at capacity. The rest goes to that store\'s backstock.'
            });
            left = 0;
          }
        });
      });
    });

    return suggestions;
  }

  function proposeShareShifts(input) {
    var cfg = input || {};
    var stores = normalizeStores(cfg.stores);
    var targets = splitTargets(stores);
    var skipList = cfg.skipList || [];
    var perDish = cfg.perDish || {};
    var outs = {};
    var stars = {};

    function remember(bucket, row, addQty) {
      var name = row.name || row.dishName || row.dish;
      var store = storeIdFromLocation(row.store || row.location);
      if (!name || !storeById(targets, store)) return;
      bucket[name] = bucket[name] || {};
      if (addQty) bucket[name][store] = (bucket[name][store] || 0) + Math.max(0, Math.round(Number(row.qty) || 0));
      else bucket[name][store] = true;
    }
    (cfg.stockouts || []).forEach(function (row) { remember(outs, row, false); });
    (cfg.orangeStar || []).forEach(function (row) { remember(stars, row, true); });

    var names = {};
    (cfg.dishes || []).forEach(function (dish) {
      var label = dish && (dish.name || dish.dish);
      if (label) names[label] = dish;
    });
    Object.keys(outs).forEach(function (name) { names[name] = names[name] || { name: name }; });
    Object.keys(stars).forEach(function (name) { names[name] = names[name] || { name: name }; });

    return Object.keys(names).sort().map(function (name) {
      var dish = names[name];
      var label = dish.name || dish.dish || name;
      if (isSkipped(label, skipList)) return null;
      var currentStores = targets;
      if (perDish[label] && typeof perDish[label] === 'object') currentStores = applyPerDishShares(targets, perDish[label]);
      var current = {};
      currentStores.forEach(function (store) { current[store.id] = Number(store.share) || 0; });
      var outRow = outs[name] || outs[label] || {};
      var starRow = stars[name] || stars[label] || {};
      var outIds = currentStores.filter(function (store) { return outRow[store.id]; }).map(function (store) { return store.id; });
      var starIds = currentStores.filter(function (store) { return starRow[store.id] > 0; }).map(function (store) { return store.id; });
      var towardId = outIds.length === 1 ? outIds[0] : '';
      var awayId = starIds.length === 1 ? starIds[0] : '';
      var conflict = false;
      if (outIds.length > 1 || starIds.length > 1) conflict = true;
      if (towardId && awayId && towardId === awayId) conflict = true;
      if (!towardId && !awayId) return null;
      if (conflict) {
        return {
          dish: label,
          currentShares: current,
          nextShares: clone(current),
          direction: 'none',
          note: 'Outs and orange star point different ways. No change.'
        };
      }
      var stack = stackSizeFor(label, cfg);
      var plated = Math.max(0, Math.round(Number(dish.plated) || 0));
      var basis = plated > 0 ? plated : 100;
      var points = (stack / basis) * 100;
      var next = shiftShares(current, towardId, awayId, points);
      var changed = currentStores.some(function (store) {
        return Math.abs((next[store.id] || 0) - (current[store.id] || 0)) > 0.0001;
      });
      if (!changed) return null;
      var direction = towardId || awayId;
      var directionName = (storeById(currentStores, direction) || {}).name || direction;
      return {
        dish: label,
        currentShares: current,
        nextShares: next,
        direction: towardId || ('away:' + awayId),
        stack: stack,
        basis: basis,
        note: towardId
          ? 'Shift 1 stack toward ' + directionName + '.'
          : 'Shift 1 stack away from ' + directionName + '.'
      };
    }).filter(Boolean);
  }

  function shiftShares(current, towardId, awayId, points) {
    var next = clone(current);
    var ids = Object.keys(next);
    if (towardId && next[towardId] != null) {
      var others = ids.filter(function (id) { return id !== towardId; });
      var pool = others.reduce(function (sum, id) { return sum + next[id]; }, 0);
      var keep = others.length * 1;
      var move = Math.min(points, Math.max(0, pool - keep));
      if (move > 0 && pool > 0) {
        others.forEach(function (id) { next[id] -= move * (current[id] / pool); });
        next[towardId] += move;
      }
      return next;
    }
    if (awayId && next[awayId] != null) {
      var receivers = ids.filter(function (id) { return id !== awayId; });
      var receiverPool = receivers.reduce(function (sum, id) { return sum + next[id]; }, 0);
      var give = Math.min(points, Math.max(0, next[awayId] - 1));
      if (give > 0 && receivers.length) {
        next[awayId] -= give;
        receivers.forEach(function (id) {
          var portion = receiverPool > 0 ? current[id] / receiverPool : 1 / receivers.length;
          next[id] += give * portion;
        });
      }
    }
    return next;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function addDaysIso(iso, days) {
    var parts = String(iso || '').split('-').map(Number);
    var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    dt.setUTCDate(dt.getUTCDate() + (Math.round(Number(days) || 0)));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  function isoToUseByKey(iso) {
    var parts = String(iso || '').split('-').map(Number);
    return parts[1] + '-' + parts[2];
  }

  function useByKeyToIso(key, todayIso) {
    var bits = String(key || '').split('-').map(Number);
    var month = bits[0];
    var day = bits[1];
    var todayParts = String(todayIso || '2026-01-01').split('-').map(Number);
    var today = Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]);
    var best = null;
    [todayParts[0] - 1, todayParts[0], todayParts[0] + 1].forEach(function (year) {
      var stamp = Date.UTC(year, month - 1, day);
      var dist = Math.round((stamp - today) / 86400000);
      var inWindow = dist >= -21 && dist <= 21;
      var score = (inWindow ? 0 : 1000) + Math.abs(dist);
      if (!best || score < best.score) {
        var dt = new Date(stamp);
        best = {
          score: score,
          iso: dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate())
        };
      }
    });
    return best ? best.iso : todayIso;
  }

  function allocateOldestFirst(lots, need, todayIso) {
    var left = Math.max(0, Math.round(Number(need) || 0));
    var sorted = (lots || []).map(function (lot) {
      return {
        useBy: lot.useBy,
        qty: Math.max(0, Math.round(Number(lot.qty) || 0)),
        iso: useByKeyToIso(lot.useBy, todayIso)
      };
    }).filter(function (lot) { return lot.qty > 0 && lot.useBy; });
    sorted.sort(function (a, b) {
      if (a.iso < b.iso) return -1;
      if (a.iso > b.iso) return 1;
      return 0;
    });
    var moves = [];
    sorted.forEach(function (lot) {
      if (left <= 0) return;
      var take = Math.min(left, lot.qty);
      moves.push({ useBy: lot.useBy, iso: lot.iso, qty: take });
      left -= take;
    });
    var moved = Math.max(0, Math.round(Number(need) || 0)) - left;
    return { moves: moves, moved: moved, shortfall: left };
  }

  function applyTransfer(inventory, request) {
    var data = clone(inventory || {});
    var from = request && request.from;
    var to = request && request.to;
    var updates = {};
    var logItems = [];
    var short = false;
    (request && request.lines || []).forEach(function (line) {
      var dk = line.dishKey;
      if (!dk || !from || !to || from === to) return;
      data[dk] = data[dk] || {};
      var lots = Object.keys(data[dk]).map(function (useBy) {
        return { useBy: useBy, qty: Math.round(Number(data[dk][useBy] && data[dk][useBy][from]) || 0) };
      });
      var plan = allocateOldestFirst(lots, line.qty, request.today);
      plan.moves.forEach(function (move) {
        var locData = data[dk][move.useBy] || {};
        var available = Math.round(Number(locData[from]) || 0);
        var currentTo = Math.round(Number(locData[to]) || 0);
        locData[from] = available - move.qty;
        locData[to] = currentTo + move.qty;
        data[dk][move.useBy] = locData;
        updates[dk + '/' + move.useBy + '/' + from] = locData[from];
        updates[dk + '/' + move.useBy + '/' + to] = locData[to];
        logItems.push({ dish: dk, dishName: line.name || dk, useBy: move.useBy, qty: move.qty });
      });
      if (plan.shortfall > 0) {
        short = true;
        logItems.push({ dish: dk, dishName: line.name || dk, useBy: 'n/a', qty: 0, note: 'Short ' + plan.shortfall + ' units' });
      }
    });
    return { inventory: data, updates: updates, logItems: logItems, short: short };
  }

  function splitCsvLine(line) {
    var out = [];
    var cur = '';
    var quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function matchStore(value, stores) {
    var raw = String(value || '').toLowerCase().trim();
    if (!raw) return '';
    var list = normalizeStores(stores);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id.toLowerCase() === raw || list[i].name.toLowerCase() === raw) return list[i].id;
    }
    return '';
  }

  function normalizeChannel(value) {
    var s = String(value || '').toLowerCase().trim();
    if (s === 'delivery' || s === 'del' || s === 'd') return 'delivery';
    return 'pickup';
  }

  function parsePrepaidCsv(text, stores) {
    var lines = String(text || '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) return [];
    var header = splitCsvLine(lines[0]).map(function (cell) { return cell.toLowerCase(); });
    var known = { dish: 1, name: 1, store: 1, location: 1, qty: 1, quantity: 1, type: 1, channel: 1 };
    var hasHeader = header.some(function (cell) { return known[cell]; });
    function col(names, fallback) {
      if (!hasHeader) return fallback;
      for (var i = 0; i < names.length; i++) {
        var at = header.indexOf(names[i]);
        if (at >= 0) return at;
      }
      return -1;
    }
    var dishCol = col(['dish', 'name'], 0);
    var storeCol = col(['store', 'location'], 1);
    var qtyCol = col(['qty', 'quantity'], 2);
    var typeCol = col(['type', 'channel'], 3);
    var rows = [];
    for (var i = hasHeader ? 1 : 0; i < lines.length; i++) {
      var cells = splitCsvLine(lines[i]);
      var dish = dishCol >= 0 ? cells[dishCol] : '';
      var qty = Math.round(Number(qtyCol >= 0 ? cells[qtyCol] : 0) || 0);
      if (!dish || qty === 0) continue;
      rows.push({
        dish: dish,
        store: matchStore(storeCol >= 0 ? cells[storeCol] : '', stores),
        qty: Math.abs(qty),
        type: normalizeChannel(typeCol >= 0 ? cells[typeCol] : '')
      });
    }
    return rows;
  }

  function aggregateOrders(rows) {
    var by = {};
    (rows || []).forEach(function (row) {
      if (!row || !row.dish) return;
      if (!by[row.dish]) by[row.dish] = { dish: row.dish, pickups: {}, delivery: 0 };
      var qty = Math.max(0, Math.round(Number(row.qty) || 0));
      if (row.type === 'delivery') by[row.dish].delivery += qty;
      else if (row.store) by[row.dish].pickups[row.store] = (by[row.dish].pickups[row.store] || 0) + qty;
    });
    return Object.keys(by).map(function (key) { return by[key]; });
  }

  function headerIndex(header, names) {
    for (var i = 0; i < names.length; i++) {
      var at = header.indexOf(names[i]);
      if (at >= 0) return at;
    }
    return -1;
  }

  function parseSkuCsv(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) return [];
    var header = splitCsvLine(lines[0]).map(function (cell) { return cell.toLowerCase(); });
    var skuCol = headerIndex(header, ['variant sku', 'sku']);
    var titleCol = headerIndex(header, ['title', 'product title', 'dish', 'name']);
    var barcodeCol = headerIndex(header, ['variant barcode', 'barcode', 'upc']);
    var start = skuCol >= 0 || titleCol >= 0 ? 1 : 0;
    if (skuCol < 0) skuCol = 0;
    if (titleCol < 0) titleCol = 1;
    var rows = [];
    for (var i = start; i < lines.length; i++) {
      var cells = splitCsvLine(lines[i]);
      var sku = normalizeBarcode(cells[skuCol] || '');
      var dish = cells[titleCol] || '';
      var barcode = barcodeCol >= 0 ? normalizeBarcode(cells[barcodeCol] || '') : '';
      if (!sku || !dish) continue;
      rows.push({ sku: sku, dish: dish, barcode: barcode });
    }
    return rows;
  }

  function skuMapFromRows(rows) {
    var map = {};
    (rows || []).forEach(function (row) {
      if (!row || !row.sku || !row.dish) return;
      map[normalizeBarcode(row.sku)] = { dish: row.dish, source: 'sku' };
      if (row.barcode) map[normalizeBarcode(row.barcode)] = { dish: row.dish, source: 'sku' };
    });
    return map;
  }

  function findInMap(norm, map) {
    if (!norm || !map) return null;
    if (map[norm]) {
      var direct = map[norm];
      return { code: norm, dish: direct.dish || direct.dishName || direct, source: direct.source || 'manual' };
    }
    var stripped = norm.replace(/^0+/, '');
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var keyNorm = normalizeBarcode(keys[i]).replace(/^0+/, '');
      if (stripped && keyNorm === stripped) {
        var hit = map[keys[i]];
        return { code: keys[i], dish: hit.dish || hit.dishName || hit, source: hit.source || 'manual' };
      }
    }
    return null;
  }

  function lookupBarcode(code, manualMap, skuMap) {
    var norm = normalizeBarcode(code);
    var skuHit = findInMap(norm, skuMap);
    if (skuHit) return skuHit;
    return findInMap(norm, manualMap);
  }

  function platedFromProduction(data, dayKeys) {
    var days = Array.isArray(dayKeys) ? dayKeys : [dayKeys];
    var map = {};
    days.forEach(function (day) {
      var block = data && data[day];
      if (!block || typeof block !== 'object') return;
      Object.keys(block).forEach(function (stationName) {
        var station = block[stationName];
        var dishes = station && station.dishes;
        if (!Array.isArray(dishes)) return;
        dishes.forEach(function (dish) {
          if (!dish || !dish.name) return;
          if (!map[dish.name]) map[dish.name] = { dish: dish.name, plated: 0, fromFinal: 0, fromOrdered: 0 };
          var finalBlank = dish.finalCount == null || String(dish.finalCount).trim() === '';
          var carried = !!(dish.carriedTo || dish.fullOrdered);
          if (!finalBlank) {
            var finished = parseInt(dish.finalCount, 10) || 0;
            map[dish.name].plated += finished;
            map[dish.name].fromFinal += finished;
          } else if (!carried) {
            var ordered = parseInt(dish.ordered, 10) || 0;
            map[dish.name].plated += ordered;
            map[dish.name].fromOrdered += ordered;
          }
        });
      });
    });
    return Object.keys(map).map(function (key) { return map[key]; });
  }

  return {
    DEFAULT_STORES: DEFAULT_STORES,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    defaultDoors: defaultDoors,
    normalizeStores: normalizeStores,
    splitTargets: splitTargets,
    sharesStatus: sharesStatus,
    addStore: addStore,
    backstockLocationId: backstockLocationId,
    storeIdFromLocation: storeIdFromLocation,
    locationsFor: locationsFor,
    defaultShelfPlan: defaultShelfPlan,
    shelfCapacity: shelfCapacity,
    shelfSlot: shelfSlot,
    roundToStack: roundToStack,
    normalizeName: normalizeName,
    normalizeBarcode: normalizeBarcode,
    isSkipped: isSkipped,
    stackSizeFor: stackSizeFor,
    splitDish: splitDish,
    splitBatch: splitBatch,
    allocationTotal: allocationTotal,
    storeTransferQty: storeTransferQty,
    rebalanceSuggestions: rebalanceSuggestions,
    proposeShareShifts: proposeShareShifts,
    addDaysIso: addDaysIso,
    isoToUseByKey: isoToUseByKey,
    useByKeyToIso: useByKeyToIso,
    allocateOldestFirst: allocateOldestFirst,
    applyTransfer: applyTransfer,
    parsePrepaidCsv: parsePrepaidCsv,
    aggregateOrders: aggregateOrders,
    parseSkuCsv: parseSkuCsv,
    skuMapFromRows: skuMapFromRows,
    lookupBarcode: lookupBarcode,
    platedFromProduction: platedFromProduction
  };
});
