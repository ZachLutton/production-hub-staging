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
    priceApprovals: 'staging_zedops_price_approvals',
    ingredientMap: 'staging_zedops_ingredient_map',
    recipe: 'staging_zedops_recipe',
    plate: 'staging_zedops_plate'
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
    if (parts[0] === PATHS.ingredientMap && parts.length !== 2) throw new Error('Ingredient matches are saved one name at a time.');
    if (parts[0] === PATHS.recipe && parts.length !== 3) throw new Error('Recipe lines are saved one ingredient at a time.');
    if (parts[0] === PATHS.plate && parts.length !== 2) throw new Error('A plate list is saved one cook date at a time.');
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

  var MATCH_HIDDEN = 'match';

  function setHidden(db, locationId, itemId, hidden) {
    var path = PATHS.hidden + '/' + locationId + '/' + itemId;
    return hidden ? refOf(db, path).set(true) : refOf(db, path).remove();
  }

  function setMatchHidden(db, itemId, hidden) {
    return setHidden(db, MATCH_HIDDEN, itemId, hidden);
  }

  function setCountUnit(db, itemId, unit) {
    return refOf(db, PATHS.catalog + '/items/' + itemId).update({ countUnit: String(unit || '').trim() });
  }

  function setItemFields(db, itemId, fields) {
    return refOf(db, PATHS.catalog + '/items/' + itemId).update(fields || {});
  }

  function setIngredientMatch(db, nameKey, value) {
    var path = PATHS.ingredientMap + '/' + nameKey;
    if (value == null) return refOf(db, path).remove();
    return refOf(db, path).set(value);
  }

  function setPlateTotal(db, cookDate, value) {
    var path = PATHS.plate + '/' + cookDate;
    if (value == null) return refOf(db, path).remove();
    var total = Number(value.totalCook);
    if (!isFinite(total) || total < 0) return Promise.reject(new Error('Total Cook must be zero or more.'));
    return refOf(db, path).set({ cookDate: cookDate, totalCook: total });
  }

  function setRecipeLine(db, weekKey, lineId, value) {
    var path = PATHS.recipe + '/' + weekKey + '/' + lineId;
    if (value == null) return refOf(db, path).remove();
    return refOf(db, path).set(value);
  }

  // One update for the whole approval. The week node is replaced, so a repeat cannot add a second copy of a line.
  function saveRecipeApproval(db, plan) {
    var week = plan && String(plan.week || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return Promise.reject(new Error('Recipe week is missing.'));
    var update = {};
    update[PATHS.recipe + '/' + week] = plan.lines && typeof plan.lines === 'object' ? plan.lines : {};
    var matches = plan.matches || {};
    try {
      Object.keys(matches).forEach(function (key) {
        if (!/^[a-z0-9_]{1,80}$/.test(key)) throw new Error('Bad ingredient key.');
        update[PATHS.ingredientMap + '/' + key] = matches[key];
      });
      Object.keys(update).forEach(function (path) {
        var recipeWeek = path === PATHS.recipe + '/' + week;
        var match = path.indexOf(PATHS.ingredientMap + '/') === 0 && path.split('/').length === 2;
        if (!recipeWeek && !match) throw new Error('Recipe approval cannot write ' + path);
      });
    } catch (err) {
      return Promise.reject(err);
    }
    return db.ref().update(update);
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

  // One recipe line at a time, including a Tuesday key that moved onto the cook date.
  function writeMigratedRecipe(db, before, after) {
    var previous = before || {};
    var next = after || {};
    var weeks = {};
    Object.keys(previous).forEach(function (key) { weeks[key] = true; });
    Object.keys(next).forEach(function (key) { weeks[key] = true; });
    var chain = Promise.resolve();
    Object.keys(weeks).forEach(function (week) {
      var beforeLines = previous[week] || {};
      var afterLines = next[week] || {};
      var keys = {};
      Object.keys(beforeLines).forEach(function (key) { keys[key] = true; });
      Object.keys(afterLines).forEach(function (key) { keys[key] = true; });
      Object.keys(keys).forEach(function (lineId) {
        var had = Object.prototype.hasOwnProperty.call(beforeLines, lineId);
        var has = Object.prototype.hasOwnProperty.call(afterLines, lineId);
        if (has && (!had || JSON.stringify(beforeLines[lineId]) !== JSON.stringify(afterLines[lineId]))) {
          chain = chain.then(function () { return setRecipeLine(db, week, lineId, afterLines[lineId]); });
        } else if (had && !has) {
          chain = chain.then(function () { return setRecipeLine(db, week, lineId, null); });
        }
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
    MATCH_HIDDEN: MATCH_HIDDEN,
    setHidden: setHidden,
    setMatchHidden: setMatchHidden,
    setCountUnit: setCountUnit,
    setItemFields: setItemFields,
    setIngredientMatch: setIngredientMatch,
    setRecipeLine: setRecipeLine,
    setPlateTotal: setPlateTotal,
    saveRecipeApproval: saveRecipeApproval,
    setLocation: setLocation,
    applyWrites: applyWrites,
    approvalUpdate: approvalUpdate,
    savePriceApproval: savePriceApproval,
    writeMigratedCounts: writeMigratedCounts,
    writeMigratedRecipe: writeMigratedRecipe
  };
});
