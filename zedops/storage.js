// Per-item saves. A count, a par, a hide, or a price is one field.
// Nothing here replaces a whole week, a whole catalog, or another module's data.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var PATHS = {
    schema: 'staging_zedops_schema',
    locations: 'staging_zedops_locations',
    catalog: 'staging_zedops_catalog',
    counts: 'staging_zedops_counts',
    pars: 'staging_zedops_pars',
    hidden: 'staging_zedops_hidden',
    drafts: 'staging_zedops_drafts',
    priceApprovals: 'staging_zedops_price_approvals'
  };

  var WHOLE_LIST = {};
  Object.keys(PATHS).forEach(function (key) { WHOLE_LIST[PATHS[key]] = true; });
  WHOLE_LIST.staging_inventory = true;
  WHOLE_LIST.staging_weekly_orders = true;

  function clean(path) {
    return String(path || '').replace(/^\/+|\/+$/g, '');
  }

  function assertWritable(path) {
    var p = clean(path);
    // The schema node is one version record, not a list of counts.
    if (p === PATHS.schema) return p;
    if (!p || WHOLE_LIST[p]) throw new Error('Refusing to replace a whole list (' + (p || 'empty') + ').');
    var parts = p.split('/');
    if (parts[0] === 'staging_inventory' || parts[0] === 'staging_weekly_orders') {
      throw new Error('This save does not rewrite monthly inventory or the Rim weekly order.');
    }
    if (parts[0] === PATHS.counts && parts.length !== 4) {
      throw new Error('On-hand counts are saved one item at a time.');
    }
    if (parts[0] === PATHS.pars && parts.length !== 3) throw new Error('Pars are saved one item at a time.');
    if (parts[0] === PATHS.hidden && parts.length !== 3) throw new Error('Hidden items are saved one item at a time.');
    if (parts[0] === PATHS.locations && parts.length !== 2) throw new Error('Stores are saved one store at a time.');
    if (parts[0] === PATHS.catalog && parts[1] === 'items' && parts.length !== 3) {
      throw new Error('Catalog items are saved one item at a time.');
    }
    return p;
  }

  function countPath(locationId, weekKey, itemId) {
    return assertWritable(PATHS.counts + '/' + locationId + '/' + weekKey + '/' + itemId);
  }

  function refOf(db, path) {
    return db.ref(assertWritable(path));
  }

  function setOnHand(db, locationId, weekKey, itemId, value) {
    var path = countPath(locationId, weekKey, itemId);
    if (value == null || value === '') return refOf(db, path).remove();
    var number = Number(value);
    if (!isFinite(number) || number < 0) return Promise.reject(new Error('Enter a count of zero or more.'));
    return refOf(db, path).set(number);
  }

  function setPar(db, locationId, itemId, par) {
    var path = PATHS.pars + '/' + locationId + '/' + itemId;
    if (par == null) return refOf(db, path).remove();
    return refOf(db, path).set({ value: Number(par.value) || 0, unit: String(par.unit || '') });
  }

  function setHidden(db, locationId, itemId, hidden) {
    var path = PATHS.hidden + '/' + locationId + '/' + itemId;
    return hidden ? refOf(db, path).set(true) : refOf(db, path).remove();
  }

  function setCountUnit(db, itemId, unit) {
    return refOf(db, PATHS.catalog + '/items/' + itemId).update({ countUnit: String(unit || '').trim() });
  }

  function setItemFields(db, itemId, fields) {
    return refOf(db, PATHS.catalog + '/items/' + itemId).update(fields || {});
  }

  function setLocation(db, location) {
    if (!location || !location.id) return Promise.reject(new Error('Store is missing an id.'));
    return refOf(db, PATHS.locations + '/' + location.id).set(location);
  }

  function applyWrites(db, writes) {
    var list = writes || [];
    var chain = Promise.resolve();
    list.forEach(function (write) {
      chain = chain.then(function () {
        var path = assertWritable(write.path);
        if (write.op === 'set') return db.ref(path).set(write.value);
        if (write.op === 'update') return db.ref(path).update(write.value || {});
        if (write.op === 'remove') return db.ref(path).remove();
        throw new Error('Unknown save.');
      });
    });
    return chain;
  }

  function approvalUpdate(month, approval) {
    var map = {};
    map[month + '/schemaVersion'] = 1;
    map[month + '/month'] = month;
    map[month + '/approvedAt'] = approval.approvedAt;
    Object.keys(approval.prices || {}).forEach(function (itemNumber) {
      map[month + '/prices/' + itemNumber] = approval.prices[itemNumber];
    });
    Object.keys(map).forEach(function (key) { assertWritable(PATHS.priceApprovals + '/' + key); });
    return map;
  }

  function savePriceApproval(db, month, approval) {
    return db.ref(PATHS.priceApprovals).update(approvalUpdate(month, approval));
  }

  // Copy only counts that a migration actually changed, one item at a time.
  function writeMigratedCounts(db, before, after) {
    var previous = before || {};
    var next = after || {};
    var locs = {};
    Object.keys(previous).forEach(function (key) { locs[key] = true; });
    Object.keys(next).forEach(function (key) { locs[key] = true; });
    var chain = Promise.resolve();
    Object.keys(locs).forEach(function (loc) {
      var beforeWeeks = previous[loc] || {};
      var afterWeeks = next[loc] || {};
      var weeks = {};
      Object.keys(beforeWeeks).forEach(function (key) { weeks[key] = true; });
      Object.keys(afterWeeks).forEach(function (key) { weeks[key] = true; });
      Object.keys(weeks).forEach(function (week) {
        var beforeItems = beforeWeeks[week] || {};
        var afterItems = afterWeeks[week] || {};
        var keys = {};
        Object.keys(beforeItems).forEach(function (key) { keys[key] = true; });
        Object.keys(afterItems).forEach(function (key) { keys[key] = true; });
        Object.keys(keys).forEach(function (itemId) {
          var had = Object.prototype.hasOwnProperty.call(beforeItems, itemId);
          var has = Object.prototype.hasOwnProperty.call(afterItems, itemId);
          if (has && (!had || JSON.stringify(beforeItems[itemId]) !== JSON.stringify(afterItems[itemId]))) {
            chain = chain.then(function () { return setOnHand(db, loc, week, itemId, afterItems[itemId]); });
          } else if (had && !has) {
            chain = chain.then(function () { return setOnHand(db, loc, week, itemId, null); });
          }
        });
      });
    });
    return chain;
  }

  return {
    PATHS: PATHS,
    assertWritable: assertWritable,
    countPath: countPath,
    setOnHand: setOnHand,
    setPar: setPar,
    setHidden: setHidden,
    setCountUnit: setCountUnit,
    setItemFields: setItemFields,
    setLocation: setLocation,
    applyWrites: applyWrites,
    approvalUpdate: approvalUpdate,
    savePriceApproval: savePriceApproval,
    writeMigratedCounts: writeMigratedCounts
  };
});
