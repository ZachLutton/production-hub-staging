// One weekly order page: production catalog, store supplies, recipe needs, and the BEK order.
(function () {
  var boot = ZedBoot.start({ storageKey: 'zedops_staging_weekly_local_v1' });
  if (boot.mode === 'blocked') throw new Error('Refusing to start. firebase-config.js points at the live Production Hub.');
  var db = boot.db;
  var state = {
    role: 'team',
    locationId: '',
    weekKey: '',
    view: location.hash === '#order' ? 'order' : 'store',
    catalog: ZedCatalog.emptyCatalog(),
    locationDoc: {},
    rows: [],
    onHand: {},
    pars: {},
    legacyOnHand: {},
    legacyPars: {},
    hands: {},
    legacyById: {},
    allPars: {},
    recipe: {},
    plate: null,
    pendingPlate: null,
    packChoices: {},
    caseSizes: {},
    matches: {},
    catalogHidden: {},
    showHiddenIngredients: false,
    showHiddenCatalog: false,
    pendingRecipe: null,
    pendingGuide: null,
    approvingRecipe: false
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function stores() {
    return ZedLocations.listLocations(state.locationDoc);
  }
  function currentStore() {
    var list = stores();
    for (var i = 0; i < list.length; i++) if (list[i].id === state.locationId) return list[i];
    return list[0] || null;
  }
  function markSaved() {
    var now = new Date();
    var stamp = [now.getHours(), now.getMinutes(), now.getSeconds()].map(function (n) { return String(n).padStart(2, '0'); }).join(':');
    var el = document.getElementById('lastSaved');
    if (el) el.textContent = 'Saved at ' + stamp;
  }
  function setPageStatus(text, isError) {
    var el = document.getElementById('pageStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = isError ? 'error' : '';
  }
  function showError(err) {
    console.error(err);
    setPageStatus((err && err.message) || 'Could not save that change.', true);
  }
  function itemIdForInventory(item) {
    if (item.itemNumber) return ZedCatalog.catalogId('bek', item.itemNumber);
    return 'inv__' + ZedRecipe.nameKey(item.name || 'item');
  }
  function catalogItem(id) {
    return state.catalog.items[id] || null;
  }

  function ensureInventory(loc) {
    var monthlyId = loc.monthlyLocationId || loc.id;
    var ref = db.ref('staging_inventory/' + monthlyId + '/items');
    return ref.once('value').then(function (snap) {
      if (!ZedWeekly.itemsNodeEmpty(snap.val())) return snap.val();
      if (monthlyId !== 'rim' && monthlyId !== 'main') return snap.val() || {};
      return fetch('zedops/weekly-location-items.json').then(function (response) {
        if (!response.ok) throw new Error('Could not load the store item list.');
        return response.json();
      }).then(function (tables) {
        var payload = tables[monthlyId];
        if (!payload) return {};
        return ref.transaction(function (current) {
          return ZedWeekly.itemsNodeEmpty(current) ? payload : undefined;
        }).then(function () { return ref.once('value'); }).then(function (again) { return again.val() || payload; });
      });
    });
  }

  function rowsForStore(loc) {
    if (ZedLocations.listSourceOf(loc) === 'catalog') {
      var rows = [];
      ['guide', 'special', 'vendorChecks'].forEach(function (shelf) {
        ZedBek.orderedItems(state.catalog, shelf).forEach(function (item) {
          rows.push({ id: item.id, item: item, legacyKey: '', section: item.label || '', source: shelf });
        });
      });
      return Promise.resolve(rows);
    }
    return ensureInventory(loc).then(function (raw) {
      var sections = ZedWeekly.sectionsFromSnapshot(raw || {});
      var rows = [];
      Object.keys(sections).forEach(function (section) {
        sections[section].forEach(function (item, index) {
          if (!item || item.hidden === true) return;
          var id = itemIdForInventory(item);
          var known = catalogItem(id);
          rows.push({
            id: id,
            item: known || {
              id: id,
              vendor: 'bek',
              itemNumber: item.itemNumber || '',
              name: item.name || '',
              brand: item.brand || '',
              pack: item.pack || '',
              label: section,
              countUnit: 'each',
              kind: 'supply',
              guidePar: null
            },
            legacyKey: ZedWeekly.getItemKey(section, item, index),
            section: section,
            source: 'inventory'
          });
        });
      });
      return rows;
    });
  }

  function handOf(row, loc) {
    loc = loc || currentStore();
    if (!loc) return null;
    var bag = (state.hands && state.hands[loc.id]) || (loc.id === state.locationId ? state.onHand : {});
    if (bag && bag[row.id] != null && bag[row.id] !== '') return Number(bag[row.id]);
    var remembered = state.legacyById && state.legacyById[loc.id];
    if (remembered && remembered[row.id] != null) return remembered[row.id];
    if (loc.id === state.locationId && row.legacyKey && state.legacyOnHand[row.legacyKey] != null) {
      return Number(state.legacyOnHand[row.legacyKey]) || 0;
    }
    return null;
  }
  function parRecord(row, loc) {
    loc = loc || currentStore();
    var bag = loc && state.allPars ? state.allPars[loc.id] : null;
    if (bag && bag[row.id] && typeof bag[row.id] === 'object') return bag[row.id];
    if ((!loc || loc.id === state.locationId) && state.pars && state.pars[row.id] && typeof state.pars[row.id] === 'object') {
      return state.pars[row.id];
    }
    if (row.legacyKey && state.legacyPars && state.legacyPars[row.legacyKey]) {
      var old = state.legacyPars[row.legacyKey];
      if (typeof old === 'object') return old;
      if (old != null && old !== '') return { value: Number(old) || 0, unit: '' };
    }
    return null;
  }
  function parOf(row, loc) {
    var saved = parRecord(row, loc);
    return saved ? (Number(saved.value) || 0) : 0;
  }
  function recipeNeed(item) {
    var qty = 0;
    var unit = 'lb';
    var factor = null;
    Object.keys(state.recipe || {}).forEach(function (key) {
      var line = state.recipe[key];
      if (!line || line.catalogId !== item.id) return;
      qty += Number(line.pounds) || 0;
      unit = line.unit || 'lb';
      if (line.eachFactor) factor = Number(line.eachFactor);
    });
    if (!(qty > 0)) return null;
    return { quantity: qty, unit: unit, eachFactor: factor };
  }
  function plateSummaryNow() {
    if (!state.plate || !(Number(state.plate.totalCook) >= 0)) return null;
    return packagingSummary(plateDishList(state.plate), state.plate.totalCook);
  }
  function plateListFor(item, loc) {
    if (!item || !state.plate) return null;
    var type = ZedMeals.typeForItemNumber(item.itemNumber);
    if (!type || !type.catalogNumber) return null;
    var summary = plateSummaryNow();
    if (!summary) return null;
    var units = loc && ZedLocations.listSourceOf(loc) === 'catalog' ? ZedMeals.unitsFor(type, summary) : 0;
    return { quantity: units, unit: 'each' };
  }
  function needFor(row, loc) {
    loc = loc || currentStore();
    var recipe = loc && ZedLocations.listSourceOf(loc) === 'catalog' ? recipeNeed(row.item) : null;
    return ZedOrder.orderNeed(row.item, {
      plateList: plateListFor(row.item, loc),
      recipe: recipe,
      standingPar: ZedOrder.isFoodItem(row.item) ? 0 : parOf(row, loc),
      countUnit: row.item.countUnit || 'each'
    });
  }
  function needLabel(need) {
    var qty = ZedBek.formatQty(need.quantity);
    return qty + (need.unit ? ' ' + need.unit : '') + ' · ' + need.source;
  }
  function casesFor(row, loc) {
    var need = needFor(row, loc);
    if (!need) return 0;
    if (need.source === 'plate list') {
      var type = ZedMeals.typeForItemNumber(row.item && row.item.itemNumber);
      var size = type && Number(state.caseSizes[type.id]) > 0 ? Number(state.caseSizes[type.id]) : (type && type.caseSize);
      var fromPack = ZedOrder.packAmount(row.item && row.item.pack);
      if (!(size > 0) && fromPack) size = fromPack.perCase;
      return ZedOrder.casesToOrder(need.quantity, handOf(row, loc) || 0, size || 1);
    }
    var pack = ZedOrder.packAmount(row.item.pack);
    var countUnit = row.item.countUnit || (pack && pack.unit) || 'each';
    var needQty = ZedOrder.needInCountUnit(need.quantity, need.unit, countUnit, need.eachFactor);
    var perCase = 1;
    if (pack && ZedOrder.canonUnit(pack.unit) === ZedOrder.canonUnit(countUnit)) perCase = pack.perCase;
    else if (ZedOrder.canonUnit(countUnit) !== ZedOrder.canonUnit(need.unit) && pack) {
      needQty = ZedOrder.needInCountUnit(need.quantity, need.unit, pack.unit, need.eachFactor);
      var onHand = handOf(row, loc);
      if (onHand != null && ZedOrder.canonUnit(countUnit) === ZedOrder.canonUnit(pack.unit)) {
        return ZedOrder.casesToOrder(needQty, onHand, pack.perCase);
      }
      return ZedOrder.casesToOrder(needQty, 0, pack.perCase);
    }
    return ZedOrder.casesToOrder(needQty, handOf(row, loc) || 0, perCase);
  }

  function loadSupport(loc) {
    var week = state.weekKey;
    var jobs = [
      db.ref(ZedStorage.PATHS.counts + '/' + loc.id + '/' + week).once('value'),
      db.ref(ZedStorage.PATHS.pars + '/' + loc.id).once('value'),
      db.ref(ZedStorage.PATHS.recipe + '/' + week).once('value'),
      db.ref(ZedStorage.PATHS.ingredientMap).once('value'),
      db.ref(ZedStorage.PATHS.hidden + '/' + ZedStorage.MATCH_HIDDEN).once('value')
    ];
    if (ZedLocations.listSourceOf(loc) === 'inventory') {
      jobs.push(db.ref('staging_weekly_orders/' + loc.id + '/' + legacyCountWeek()).once('value'));
      jobs.push(db.ref('staging_weekly_orders/' + loc.id + '/pars').once('value'));
    }
    return Promise.all(jobs).then(function (snaps) {
      state.onHand = snaps[0].val() || {};
      state.pars = snaps[1].val() || {};
      state.recipe = snaps[2].val() || {};
      state.matches = snaps[3].val() || {};
      state.catalogHidden = snaps[4].val() || {};
      state.legacyOnHand = snaps[5] ? (snaps[5].val() || {}) : {};
      state.legacyPars = snaps[6] ? (snaps[6].val() || {}) : {};
      return db.ref(ZedStorage.PATHS.plate + '/' + week).once('value').then(function (plateSnap) {
        state.plate = plateSnap.val() || null;
        return db.ref(ZedStorage.PATHS.plate + '/pack').once('value');
      }).then(function (packSnap) {
        state.packChoices = (packSnap && packSnap.val()) || {};
        return db.ref(ZedStorage.PATHS.plate + '/case').once('value');
      }).then(function (caseSnap) {
        var saved = (caseSnap && caseSnap.val()) || {};
        var sizes = {};
        Object.keys(saved).forEach(function (id) {
          if (saved[id] && Number(saved[id].caseSize) > 0) sizes[id] = Number(saved[id].caseSize);
        });
        state.caseSizes = sizes;
      }).catch(function (err) {
        state.plate = state.plate || null;
        showError(err);
      });
    }).then(function () {
      return loadEveryStore();
    }).catch(function () {
      state.legacyOnHand = {};
      state.legacyPars = {};
      return loadEveryStore();
    });
  }

  function loadEveryStore() {
    state.hands = {};
    state.legacyById = {};
    state.allPars = {};
    return Promise.all(stores().map(function (loc) {
      return db.ref(ZedStorage.PATHS.counts + '/' + loc.id + '/' + state.weekKey).once('value').then(function (snap) {
        state.hands[loc.id] = snap.val() || {};
        return db.ref(ZedStorage.PATHS.pars + '/' + loc.id).once('value');
      }).then(function (snap) {
        state.allPars[loc.id] = snap.val() || {};
        if (ZedLocations.listSourceOf(loc) !== 'inventory') return null;
        return db.ref('staging_weekly_orders/' + loc.id + '/' + legacyCountWeek()).once('value').then(function (legacySnap) {
          var counts = legacySnap.val() || {};
          return ensureInventory(loc).then(function (raw) {
            var sections = ZedWeekly.sectionsFromSnapshot(raw || {});
            var map = {};
            Object.keys(sections).forEach(function (section) {
              (sections[section] || []).forEach(function (item, index) {
                if (!item) return;
                var key = ZedWeekly.getItemKey(section, item, index);
                if (counts[key] == null) return;
                map[itemIdForInventory(item)] = Number(counts[key]) || 0;
              });
            });
            state.legacyById[loc.id] = map;
          });
        }).catch(function () { state.legacyById[loc.id] = {}; });
      });
    }));
  }

  function legacyCountWeek() {
    return state.weekKey ? ZedBek.addDays(state.weekKey, -8) : '';
  }

  function syncRecipeWarning() {
    var pending = state.pendingRecipe;
    var fileCook = pending ? ZedOrder.recipeWeek(pending.cookDate) : '';
    var text = ZedBek.recipeCycleWarning(fileCook, state.weekKey);
    var el = document.getElementById('recipeCycleWarning');
    if (el) el.textContent = text;
    var button = document.getElementById('approveRecipe');
    if (button) button.disabled = !!text;
    if (text) setPageStatus(text, true);
    return text;
  }

  function reload() {
    var loc = currentStore();
    if (!loc) { state.rows = []; render(); return Promise.resolve(); }
    return rowsForStore(loc).then(function (rows) {
      state.rows = rows;
      return loadSupport(loc);
    }).then(render).catch(showError);
  }

  function fillStores() {
    var select = document.getElementById('locationSelect');
    var list = stores();
    select.innerHTML = list.map(function (loc) {
      return '<option value="' + esc(loc.id) + '">' + esc(loc.name) + '</option>';
    }).join('');
    if (!list.length) return;
    var saved = state.locationId;
    try { saved = saved || localStorage.getItem('zedops_weekly_store') || ''; } catch (e) {}
    var pick = list.filter(function (loc) { return loc.id === saved; })[0];
    if (!pick) pick = list.filter(function (loc) { return loc.isProductionHub; })[0] || list[0];
    state.locationId = pick.id;
    select.value = pick.id;
  }

  function render() {
    var loc = currentStore();
    var storeView = document.getElementById('storeView');
    var orderView = document.getElementById('orderView');
    if (storeView) storeView.style.display = state.view === 'store' ? 'block' : 'none';
    if (orderView) orderView.style.display = state.view === 'order' ? 'block' : 'none';
    var storeBtn = document.getElementById('showStore');
    var orderBtn = document.getElementById('showOrder');
    if (storeBtn) {
      storeBtn.classList.toggle('active', state.view !== 'order');
      storeBtn.setAttribute('aria-pressed', state.view !== 'order' ? 'true' : 'false');
    }
    if (orderBtn) {
      orderBtn.classList.toggle('active', state.view === 'order');
      orderBtn.setAttribute('aria-pressed', state.view === 'order' ? 'true' : 'false');
    }
    var badge = document.getElementById('locationBadge');
    if (badge && loc) {
      var kind = ZedLocations.listSourceOf(loc) === 'catalog' ? 'Full BEK catalog' : 'Store supplies';
      badge.textContent = loc.name + ' · ' + kind + (ZedLocations.roleLabel(loc) ? ' · ' + ZedLocations.roleLabel(loc) : '');
    }
    var due = document.getElementById('dueLine');
    if (due) {
      var cycle = state.weekKey ? ZedBek.formatCycle(state.weekKey) : '';
      due.textContent = (cycle ? cycle + '. ' : '') + 'Food need comes from the approved scaled recipe. Supplies use the standing par for that store. BEK guide pars are not used for the order.';
    }
    try {
      renderRecipeTools();
      renderPlateReview();
      renderMealChecks(loc);
      renderSummary(loc);
      if (state.view === 'order') renderOrder();
      else renderStore(loc);
      renderAdmin(loc);
    } catch (err) {
      showError(err);
    }
  }

  function hasApprovedRecipe() {
    return Object.keys(state.recipe || {}).some(function (key) {
      var line = state.recipe[key];
      return line && Number(line.pounds) > 0 && line.catalogId;
    });
  }

  function cookLabel() {
    return state.weekKey ? ZedBek.shortDate(state.weekKey) : 'this cook date';
  }

  function mealOnHand(id) {
    if (state.onHand && state.onHand[id] != null && state.onHand[id] !== '') return Number(state.onHand[id]);
    var bag = state.hands && state.hands[state.locationId];
    if (bag && bag[id] != null && bag[id] !== '') return Number(bag[id]);
    return null;
  }

  function plateDishList(plate) {
    if (!plate || !plate.dishes) return [];
    if (Array.isArray(plate.dishes)) return plate.dishes;
    return Object.keys(plate.dishes).map(function (key) {
      var row = plate.dishes[key] || {};
      return { key: key, name: row.name || key, count: Number(row.count) || 0 };
    });
  }

  function packagingSummary(dishes, totalCook) {
    return ZedMeals.tally(dishes, state.packChoices, totalCook);
  }

  function packSelect(dish) {
    if (state.role !== 'admin') return esc(ZedMeals.packLabel(dish.packId));
    return '<select data-pack-dish="' + esc(dish.key) + '" data-pack-name="' + esc(dish.name) + '" aria-label="Packaging for ' + esc(dish.name) + '">' +
      '<option value="meal_container"' + (dish.packId === 'meal_container' ? ' selected' : '') + '>Meal container</option>' +
      '<option value="cup_9oz"' + (dish.packId === 'cup_9oz' ? ' selected' : '') + '>9 oz cup and lid</option></select>';
  }

  function dishTable(summary) {
    if (!summary.dishes.length) return '<p class="empty-state">This saved plate list has a Total Cook but no dish lines. Upload it again to split muffins and cookies from the trays.</p>';
    return '<table class="order-table"><thead><tr><th>Dish</th><th>Count</th><th>Packaging</th></tr></thead><tbody>' +
      summary.dishes.map(function (dish) {
        return '<tr><td>' + esc(dish.name) + '</td><td>' + esc(dish.count) + '</td><td>' + packSelect(dish) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderMealChecks(loc) {
    var box = document.getElementById('mealChecks');
    if (!box) return;
    var catalogStore = loc && ZedLocations.listSourceOf(loc) === 'catalog';
    box.style.display = catalogStore ? 'block' : 'none';
    if (!catalogStore) return;
    var total = state.plate && Number(state.plate.totalCook);
    var cook = cookLabel();
    if (!(total >= 0) || !state.plate) {
      box.innerHTML = '<h2>Packaging</h2><p class="empty-state">No plate list is approved for ' + esc(cook) + '. ' +
        (state.role === 'admin' ? 'Upload that week\'s plate list above. Packaging is not on the BEK order.' : 'An admin needs to upload that week\'s plate list. Packaging is not on the BEK order.') + '</p>';
      return;
    }
    var summary = packagingSummary(plateDishList(state.plate), total);
    var hands = {};
    ['meal_container', 'cup_9oz', 'lid_9oz'].forEach(function (id) {
      var type = ZedMeals.typeOf(id);
      if (type && type.catalogNumber) {
        var catalogId = ZedCatalog.catalogId('bek', type.catalogNumber);
        hands[id] = handOf({ id: catalogId, item: state.catalog.items[catalogId] || { id: catalogId }, legacyKey: '' }, loc);
      } else {
        hands[id] = mealOnHand(id);
      }
    });
    var lines = ZedMeals.linesFor(summary, hands, state.caseSizes);
    var supplyRows = lines.map(function (line) {
      var source = line.catalogNumber
        ? 'BEK #' + line.catalogNumber + ' ' + line.catalogName + ', pack ' + line.pack + ' = ' + line.defaultCaseSize + '/cs'
        : 'Not a BEK item. ' + line.defaultCaseSize + ' per case.';
      var sizeField = state.role === 'admin'
        ? '<input data-case-size="' + esc(line.id) + '" type="number" min="1" step="1" aria-label="Case size for ' + esc(line.name) + '" value="' + esc(line.caseSize) + '" style="width:90px;font-size:16px;min-height:44px">'
        : esc(line.caseSize);
      var status = line.onBekOrder
        ? (line.orderNeeded ? 'On the BEK order' : 'On the BEK order · no cases')
        : (line.orderNeeded ? 'Pallet order needed' : 'No pallet order');
      var handId = line.catalogNumber ? ZedCatalog.catalogId('bek', line.catalogNumber) : line.id;
      return '<tr><td>' + esc(line.name) + '<div class="item-brand">' + esc(source) + (line.onBekOrder ? '. Counted on the BEK order.' : '. Not a BEK order.') + '</div></td><td>' + esc(line.need) + ' ' + esc(line.unit) + '</td><td><input data-meal-hand="' + esc(handId) + '" data-meal-type="' + esc(line.id) + '" type="number" min="0" step="any" inputmode="decimal" aria-label="On hand ' + esc(line.name) + '" value="' + (line.onHand == null ? '' : esc(line.onHand)) + '" style="width:110px;font-size:16px;min-height:44px"></td><td>' + sizeField + '</td><td class="need-order" data-meal-order="' + esc(line.id) + '">' + line.cases + ' cs</td><td data-meal-pallet="' + esc(line.id) + '">' + status + '</td></tr>';
    }).join('');
    box.innerHTML = '<h2>Packaging</h2><p>Total Cook ' + esc(summary.totalCook) + ' for ' + esc(cook) + '. Meal trays ' + esc(summary.containers) + ' stay a pallet check. Cups and lids ' + esc(summary.cup) + ' go on the BEK order as plate list, not as a standing par.</p>' +
      dishTable(summary) +
      '<table class="order-table"><thead><tr><th>Item</th><th>Need</th><th>On hand</th><th>Per case</th><th>Cases</th><th>Order</th></tr></thead><tbody>' + supplyRows + '</tbody></table>';
  }

  function renderPlateReview() {
    var panel = document.getElementById('platePanel');
    if (!panel) return;
    var pending = state.pendingPlate;
    if (!pending) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }
    var warn = ZedBek.recipeCycleWarning(pending.cookDate, state.weekKey);
    var summary = packagingSummary(pending.dishes || [], pending.totalCook);
    panel.style.display = 'block';
    panel.innerHTML = '<h2>Review the plate list</h2><p' + (warn ? ' class="recipe-warn"' : '') + '>' +
      (warn || ('Total Cook ' + esc(pending.totalCook) + ' for ' + esc(ZedBek.shortDate(pending.cookDate)) + '. Trays ' + esc(summary.containers) + '. Cups and lids ' + esc(summary.cup) + '. Approving saves the dishes. Packaging is not added to the BEK order.')) +
      '</p>' + dishTable(summary) + '<button type="button" id="approvePlate"' + (warn ? ' disabled' : '') + '>Approve plate list</button> <button type="button" id="discardPlate">Discard</button>';
    var approve = document.getElementById('approvePlate');
    var discard = document.getElementById('discardPlate');
    if (approve) approve.onclick = approvePlate;
    if (discard) discard.onclick = function () {
      state.pendingPlate = null;
      renderPlateReview();
    };
  }

  function approvePlate() {
    var pending = state.pendingPlate;
    if (!pending) return;
    var warn = ZedBek.recipeCycleWarning(pending.cookDate, state.weekKey);
    if (warn) {
      setPageStatus(warn, true);
      return;
    }
    if (!(Number(pending.totalCook) >= 0)) {
      setPageStatus('That plate list has no Total Cook, so nothing was saved.', true);
      return;
    }
    var button = document.getElementById('approvePlate');
    if (button) button.disabled = true;
    ZedStorage.setPlateTotal(db, state.weekKey, { totalCook: pending.totalCook, dishes: pending.dishes || [] }).then(function () {
      var dishes = {};
      (pending.dishes || []).forEach(function (dish) {
        if (dish && dish.key) dishes[dish.key] = { name: dish.name, count: Number(dish.count) || 0 };
      });
      state.plate = { cookDate: state.weekKey, totalCook: Number(pending.totalCook), dishes: dishes };
      state.pendingPlate = null;
      setPageStatus('Plate list saved for ' + ZedBek.shortDate(state.weekKey) + '. Total Cook ' + state.plate.totalCook + '.');
      render();
      markSaved();
    }).catch(function (err) {
      if (button) button.disabled = false;
      showError(err);
    });
  }

  function onPlateFile(file) {
    if (!file) return;
    var status = document.getElementById('plateStatus');
    function setStatus(text) { if (status) status.textContent = text; }
    setStatus('Chosen: ' + file.name + '. Reading the file…');
    var reader = new FileReader();
    reader.onerror = function () { setStatus('Chosen: ' + file.name + '. Could not read that file. Try again.'); };
    reader.onload = function () {
      setStatus('Chosen: ' + file.name + '. Parsing…');
      ZedPlatePdf.parsePlatePdf(new Uint8Array(reader.result), function (info) {
        if (info.phase === 'page') setStatus('Chosen: ' + file.name + '. Reading page ' + info.page + ' of ' + info.pages + '…');
      }).then(function (parsed) {
        if (!parsed.cookDate || !(Number(parsed.totalCook) >= 0)) {
          setStatus('Chosen: ' + file.name + '. Could not find the cook date and Total Cook.');
          return;
        }
        state.pendingPlate = parsed;
        var warn = ZedBek.recipeCycleWarning(parsed.cookDate, state.weekKey);
        setStatus('Done. ' + file.name + ' — Total Cook ' + parsed.totalCook + ' for ' + ZedBek.shortDate(parsed.cookDate) + '.' + (warn ? ' ' + warn : ''));
        if (warn) setPageStatus(warn, true);
        renderPlateReview();
      }).catch(function (err) {
        setStatus('Chosen: ' + file.name + '. ' + ((err && err.message) || 'Could not parse that PDF.'));
        showError(err);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function renderRecipeTools() {
    var tools = document.getElementById('recipeTools');
    if (tools) tools.style.display = state.role === 'admin' ? 'block' : 'none';
    var empty = document.getElementById('recipeEmpty');
    if (!empty) return;
    if (state.role === 'admin' && !state.pendingRecipe && !hasApprovedRecipe()) {
      empty.style.display = 'block';
      empty.innerHTML = '<p class="empty-state">No scaled recipes are approved for ' + esc(cookLabel()) + '. Upload that week\'s scaled-recipe PDF.</p>';
    } else {
      empty.style.display = 'none';
      empty.innerHTML = '';
    }
  }

  function renderSummary(loc) {
    var box = document.getElementById('orderSummary');
    if (!box) return;
    var catalogStore = loc && ZedLocations.listSourceOf(loc) === 'catalog';
    box.style.display = catalogStore ? 'block' : 'none';
    if (!catalogStore) return;
    var cook = cookLabel();
    if (!hasApprovedRecipe() && !state.plate) {
      box.innerHTML = '<h2>Order totals</h2><p class="empty-state">No scaled recipes are approved for ' + esc(cook) + '. ' +
        (state.role === 'admin' ? 'Upload that week\'s scaled-recipe PDF above.' : 'An admin needs to upload that week\'s scaled-recipe PDF.') + '</p>';
      return;
    }
    var lines = [];
    ZedCatalog.asList(state.catalog.shelf.guide).concat(ZedCatalog.asList(state.catalog.shelf.special)).forEach(function (id) {
      var item = state.catalog.items[id];
      if (!item || !ZedBek.isShown(item) || item.kind === 'vendor_check') return;
      var row = { id: id, item: item, legacyKey: '', source: 'guide' };
      var need = needFor(row, loc);
      var cases = casesFor(row, loc);
      if (!(need && need.quantity > 0) && !(cases > 0)) return;
      lines.push('<tr><td class="item-num">' + esc(item.itemNumber || 'no BEK #') + '</td><td>' + esc(item.name) + '</td><td>' +
        esc(needLabel(need)) + '</td><td class="need-order">' + (cases > 0 ? cases + ' cs' : '0') + '</td></tr>');
    });
    box.innerHTML = '<h2>Order totals</h2>' + (lines.length
      ? '<table class="order-table"><thead><tr><th>Item #</th><th>Name</th><th>Need</th><th>Order</th></tr></thead><tbody>' + lines.join('') + '</tbody></table>'
      : '<p class="empty-state">The approved recipes for ' + esc(cook) + ' do not add a food order.</p>');
  }

  function showView(view) {
    state.view = view === 'order' ? 'order' : 'store';
    try {
      var next = location.pathname + location.search + (state.view === 'order' ? '#order' : '');
      history.replaceState(null, '', next);
    } catch (err) {}
    render();
    var pane = document.getElementById(state.view === 'order' ? 'orderView' : 'storeView');
    if (pane && pane.scrollIntoView) pane.scrollIntoView({ block: 'nearest' });
  }

  function renderStore(loc) {
    var host = document.getElementById('itemTable');
    if (!loc) { host.innerHTML = ''; return; }
    var groups = [];
    var index = {};
    state.rows.forEach(function (row) {
      var title = row.section || 'Items';
      if (row.source === 'special') title = 'Special Order (send direct to BEK rep)';
      if (row.source === 'vendorChecks') title = 'Other vendors';
      if (!Object.prototype.hasOwnProperty.call(index, title)) {
        index[title] = groups.length;
        groups.push({ title: title, rows: [] });
      }
      groups[index[title]].rows.push(row);
    });
    host.innerHTML = groups.map(function (group) {
      return '<div class="section"><div class="section-header"><div class="section-header-title">' + esc(group.title) +
        '</div></div><table class="order-table"><thead><tr><th>Item #</th><th>Name</th><th>Pack</th><th>Need</th><th>On hand</th><th>Order</th>' +
        (state.role === 'admin' ? '<th>Par</th>' : '') + '</tr></thead><tbody>' +
        group.rows.map(function (row) { return storeRow(row, loc); }).join('') + '</tbody></table></div>';
    }).join('') || '<div class="empty-state">No items for this store yet.</div>';
  }

  function storeRow(row, loc) {
    var item = row.item;
    var need = needFor(row, loc);
    var hand = handOf(row);
    var cases = casesFor(row, loc);
    var needText = needLabel(need);
    var temp = item.temporary ? ' <span class="temp-badge">TEMPORARY</span>' : '';
    var food = ZedOrder.isFoodItem(item);
    var roleBtn = state.role === 'admin'
      ? '<button type="button" data-order-role="' + esc(row.id) + '">' + (food ? 'Food' : 'Supply') + '</button>' : '';
    var parCell = '';
    if (!food && state.role === 'admin') {
      var parValue = parOf(row, loc);
      parCell = '<input data-par="' + esc(row.id) + '" type="number" min="0" step="any" inputmode="decimal" aria-label="Standing par for ' + esc(item.name) + '" value="' + (parValue ? esc(parValue) : '') + '" style="width:90px;font-size:16px;min-height:44px"> <span data-par-note="' + esc(row.id) + '"></span>';
    }
    return '<tr><td class="item-num">' + esc(item.itemNumber || 'no BEK #') + '</td><td><div class="item-name">' +
      esc(item.name) + temp + '</div><div class="item-brand">' + esc(item.brand || '') + '</div></td><td>' + esc(item.pack || '') +
      '</td><td data-need-for="' + esc(row.id) + '">' + esc(needText) + '</td><td><input class="onhand-input" data-hand="' + esc(row.id) + '" type="number" min="0" step="any" value="' +
      (hand == null ? '' : esc(hand)) + '"></td><td class="need-order">' + (cases > 0 ? cases + ' cs' : '0') + '</td>' +
      (state.role === 'admin' ? '<td>' + parCell + roleBtn + '</td>' : '') + '</tr>';
  }

  function renderOrder() {
    var list = stores();
    if (!hasApprovedRecipe() && !state.plate) {
      document.getElementById('orderTable').innerHTML = '<p class="empty-state">No scaled recipes are approved for ' + esc(cookLabel()) + '. Upload that week\'s scaled-recipe PDF.</p>';
      state.orderRows = [];
      return;
    }
    var ids = ZedCatalog.asList(state.catalog.shelf.guide).concat(ZedCatalog.asList(state.catalog.shelf.special));
    var head = list.map(function (loc) { return '<th>' + esc(loc.name) + ' need</th><th>' + esc(loc.name) + ' on hand</th>'; }).join('');
    var body = ids.map(function (id) {
      var item = state.catalog.items[id];
      if (!item || !ZedBek.isShown(item) || item.kind === 'vendor_check') return '';
      var total = 0;
      var cells = list.map(function (loc) {
        var row = { id: id, item: item, legacyKey: '', source: 'guide' };
        var need = needFor(row, loc);
        var hand = handOf(row, loc);
        var cases = casesFor(row, loc);
        total += cases;
        return '<td>' + esc(needLabel(need)) + '</td><td>' + (hand == null ? '—' : esc(hand)) + '</td>';
      }).join('');
      return '<tr><td class="item-num">' + esc(item.itemNumber || 'no BEK #') + '</td><td><div class="item-name">' + esc(item.name) +
        (item.temporary ? ' <span class="temp-badge">TEMPORARY</span>' : '') + '</div></td>' + cells +
        '<td class="need-order">' + (total > 0 ? total + ' cs' : '0') + '</td></tr>';
    }).join('');
    document.getElementById('orderTable').innerHTML = '<table class="order-table"><thead><tr><th>Item #</th><th>Name</th>' + head +
      '<th>Total cases</th></tr></thead><tbody>' + body + '</tbody></table>';
    state.orderRows = ids.map(function (id) { return state.catalog.items[id]; }).filter(Boolean);
  }

  function renderAdmin(loc) {
    var box = document.getElementById('adminTools');
    box.style.display = state.role === 'admin' ? 'block' : 'none';
    if (state.role !== 'admin') return;
    renderRecipeReview();
    var storePanel = document.getElementById('storePanel');
    storePanel.innerHTML = '<h2>Stores</h2><p>The production hub counts the full BEK catalog. Any other store counts that store\'s supplies from monthly inventory, not the meals.</p>' +
      stores().map(function (store) {
        return '<div class="store-row"><strong>' + esc(store.name) + '</strong> ' +
          '<label><input type="checkbox" data-store="' + esc(store.id) + '" data-role="isProductionHub"' + (store.isProductionHub ? ' checked' : '') + '> Production hub</label> ' +
          '<label><input type="checkbox" data-store="' + esc(store.id) + '" data-role="isCulinaryCenter"' + (store.isCulinaryCenter ? ' checked' : '') + '> Culinary center</label> ' +
          '<label>List <select data-source="' + esc(store.id) + '"><option value="catalog"' + (ZedLocations.listSourceOf(store) === 'catalog' ? ' selected' : '') + '>Full BEK catalog</option><option value="inventory"' + (ZedLocations.listSourceOf(store) === 'inventory' ? ' selected' : '') + '>Store supplies</option></select></label></div>';
      }).join('') + '<button type="button" id="addStore">Add a store</button>';
    var add = document.getElementById('addStore');
    if (add) add.onclick = function () {
      var name = prompt('Store name');
      if (!name) return;
      var result = ZedLocations.addLocation(state.locationDoc, { name: name, listSource: 'inventory' });
      ZedStorage.setLocation(db, result.added).then(function () {
        state.locationDoc[result.added.id] = result.added;
        fillStores();
        render();
      }).catch(showError);
    };
  }

  function catalogChoices() {
    return Object.keys(state.catalog.items).map(function (id) { return state.catalog.items[id]; }).filter(function (item) {
      return item && (item.itemNumber || item.internalKey || item.name);
    });
  }
  function choiceLabel(item) {
    if (!item) return 'No match';
    return (item.itemNumber || 'no #') + ' ' + (item.name || '') + (item.brand ? ' · ' + item.brand : '');
  }
  function assignInitialMatch(row, items) {
    var saved = state.matches[row.key];
    if (saved && (Object.prototype.hasOwnProperty.call(saved, 'catalogId') || saved.hideMode)) {
      row.catalogId = saved.catalogId || '';
      row.eachFactor = saved.eachFactor == null ? '' : saved.eachFactor;
      row.hideMode = saved.hideMode || '';
      row.matchSaved = true;
      return;
    }
    var suggestion = ZedOrder.filterCatalog(row.name, items, { hidden: state.catalogHidden })[0];
    row.catalogId = suggestion ? suggestion.id : '';
    row.eachFactor = '';
    row.hideMode = '';
    row.matchSaved = false;
  }
  function setRecipeStatus(text) {
    var el = document.getElementById('recipeStatus');
    if (el) el.textContent = text;
  }
  function updateMatchCount() {
    var purchases = state.pendingRecipe ? state.pendingRecipe.purchases : [];
    var visible = purchases.filter(function (row) { return !row.hideMode; });
    var counts = ZedOrder.matchCounts(visible);
    var hidden = purchases.length - visible.length;
    var el = document.getElementById('matchCount');
    if (el) el.textContent = counts.matched + ' matched, ' + counts.unmatched + ' unmatched' + (hidden ? ', ' + hidden + ' hidden' : '');
  }
  function renderRecipeReview() {
    var panel = document.getElementById('recipePanel');
    var pending = state.pendingRecipe;
    if (!pending) {
      if (panel.getAttribute('data-built')) {
        panel.style.display = 'none';
        panel.innerHTML = '';
        panel.removeAttribute('data-built');
      }
      return;
    }
    if (panel.getAttribute('data-built') === '1' && panel._pending === pending) {
      panel.style.display = 'block';
      updateMatchCount();
      syncRecipeWarning();
      return;
    }
    var items = catalogChoices();
    pending.purchases.forEach(function (row) { assignInitialMatch(row, items); });
    panel.style.display = 'block';
    panel._pending = pending;
    panel.setAttribute('data-built', '1');
    var counts = ZedOrder.matchCounts(pending.purchases);
    var hiddenRows = pending.purchases.filter(function (row) { return row.hideMode; }).length;
    panel.innerHTML = '<h2>Review raw purchases before the order is applied</h2><p id="recipeCycleWarning" class="recipe-warn"></p><p>Cook date ' + esc(pending.cookDate || '') +
      '. These are raw weights. Cooked totals and sub-recipe outputs are not ordered twice. A match is saved as soon as you confirm that row. The week\'s order uses them only after you approve.</p>' +
      '<div class="match-tools"><input id="matchFilter" type="search" placeholder="Find an ingredient" autocomplete="off" enterkeyhint="search"><strong id="matchCount">' +
      counts.matched + ' matched, ' + counts.unmatched + ' unmatched' + (hiddenRows ? ', ' + hiddenRows + ' hidden' : '') + '</strong>' +
      '<label><input type="checkbox" id="showHiddenIngredients"' + (state.showHiddenIngredients ? ' checked' : '') + '> Show hidden ingredients</label></div>' +
      '<table class="order-table"><thead><tr><th>Ingredient</th><th>Raw amount</th><th>BEK item</th><th>Each factor</th><th></th></tr></thead><tbody>' +
      pending.purchases.map(function (row, index) {
        var chosen = row.catalogId ? state.catalog.items[row.catalogId] : null;
        var hiddenNote = row.hideMode === 'ignore' ? 'Ignored — not ordered' : (row.hideMode === 'replace' ? 'Replaced — weight carries over' : '');
        var hasWeight = Number(row.pounds) > 0;
        return '<tr class="' + (row.catalogId ? '' : 'unmatched') + (row.hideMode ? ' ingredient-hidden' : '') + '" data-ingredient="' + esc(row.name) + '" data-index="' + index + '"' + (row.hideMode && !state.showHiddenIngredients ? ' hidden' : '') + '><td>' + esc(row.name) +
          '<div class="row-saved" data-saved="' + index + '">' + (row.matchSaved ? 'Saved' : '') + (hiddenNote ? ' · ' + hiddenNote : '') + '</div></td><td>' + esc(row.pounds) + ' lb</td><td>' +
          '<div class="match-box"><button type="button" class="match-chosen" data-open="' + index + '" aria-haspopup="listbox" aria-expanded="false">' + esc(choiceLabel(chosen)) + '</button>' +
          '<div class="match-pop" data-pop="' + index + '" hidden><label class="show-hidden-label"><input type="checkbox" data-show-hidden-catalog="' + index + '"' + (state.showHiddenCatalog ? ' checked' : '') + '> Show hidden items</label><input type="search" data-search="' + index + '" placeholder="Name, brand, or item #" autocomplete="off" enterkeyhint="search">' +
          '<ul role="listbox" data-list="' + index + '"></ul></div></div>' +
          '<div class="hide-panel" data-hide-panel="' + index + '" hidden><p>' + (hasWeight
            ? '<strong>Replace with…</strong> is the default, so this ' + esc(row.pounds) + ' lb stays on the order.'
            : 'This row has no weight. <strong>Ignore</strong> is the default, so nothing is added to the order.') + '</p>' +
          '<label><input type="radio" name="hide-mode-' + index + '" value="replace"' + (hasWeight ? ' checked' : '') + '> Replace with the BEK item above. The weight carries over.</label>' +
          '<label><input type="radio" name="hide-mode-' + index + '" value="ignore"' + (hasWeight ? '' : ' checked') + '> Ignore (don\'t order). This weight will not be ordered.</label>' +
          '<button type="button" data-apply-hide="' + index + '">Hide ingredient</button> <button type="button" data-cancel-hide="' + index + '">Cancel</button></div></td><td><input data-factor="' + index + '" type="number" min="0" step="any" inputmode="decimal" placeholder="lb per each" value="' + esc(row.eachFactor) + '" style="width:120px;font-size:16px;min-height:44px"></td><td>' +
          (row.hideMode ? '<button type="button" data-unhide-row="' + index + '">Unhide</button>' : '<button type="button" data-hide-row="' + index + '">Hide</button>') +
          '</td></tr>';
      }).join('') + '</tbody></table><p class="diff-note">Choose No match when nothing fits. Hiding a weighed ingredient asks you to move the weight onto another BEK item, or to leave it off the order.</p><button type="button" id="approveRecipe">Approve recipe needs</button> <button type="button" id="discardRecipe">Discard</button>';
    document.getElementById('approveRecipe').onclick = approveRecipe;
    syncRecipeWarning();
    document.getElementById('discardRecipe').onclick = function () {
      state.pendingRecipe = null;
      renderRecipeReview();
    };
    var filter = document.getElementById('matchFilter');
    if (filter) filter.addEventListener('input', function () {
      var q = filter.value.toLowerCase();
      panel.querySelectorAll('tbody tr').forEach(function (tr) {
        var name = (tr.getAttribute('data-ingredient') || '').toLowerCase();
        tr.style.display = !q || name.indexOf(q) !== -1 ? '' : 'none';
      });
    });
  }
  function fillMatchList(index, query) {
    var list = document.querySelector('[data-list="' + index + '"]');
    var row = state.pendingRecipe.purchases[index];
    var choices = ZedOrder.filterCatalog(query, catalogChoices(), {
      hidden: state.catalogHidden,
      showHidden: state.showHiddenCatalog
    }).slice(0, 40);
    if (row.catalogId && !choices.some(function (item) { return item.id === row.catalogId; }) && (state.showHiddenCatalog || !state.catalogHidden[row.catalogId])) {
      var selected = state.catalog.items[row.catalogId];
      if (selected) choices.unshift(selected);
    }
    var html = '<li role="option" data-id=""' + (row.catalogId ? '' : ' aria-selected="true"') + '>No match</li>';
    choices.forEach(function (item) {
      var hidden = !!state.catalogHidden[item.id];
      html += '<li role="option" data-id="' + esc(item.id) + '"' + (item.id === row.catalogId ? ' aria-selected="true"' : '') + '>' +
        '<span>' + esc(choiceLabel(item)) + (hidden ? ' (hidden)' : '') + '</span> ' +
        (hidden
          ? '<button type="button" data-unhide-catalog="' + esc(item.id) + '">Unhide</button>'
          : '<button type="button" data-hide-catalog="' + esc(item.id) + '">Hide</button>') +
        '</li>';
    });
    list.innerHTML = html;
  }
  function closeMatchPops(except) {
    document.querySelectorAll('.match-pop').forEach(function (pop) {
      if (except != null && pop.getAttribute('data-pop') === String(except)) return;
      pop.hidden = true;
    });
    document.querySelectorAll('.match-chosen').forEach(function (button) {
      if (except != null && button.getAttribute('data-open') === String(except)) return;
      button.setAttribute('aria-expanded', 'false');
    });
  }
  function saveMatch(index) {
    var row = state.pendingRecipe && state.pendingRecipe.purchases[index];
    if (!row) return Promise.resolve();
    var factorEl = document.querySelector('[data-factor="' + index + '"]');
    var eachFactor = factorEl && factorEl.value !== '' ? Number(factorEl.value) : null;
    row.eachFactor = eachFactor == null ? '' : eachFactor;
    return ZedStorage.setIngredientMatch(db, row.key, {
      name: row.name,
      catalogId: row.catalogId || '',
      eachFactor: eachFactor,
      hideMode: row.hideMode || ''
    }).then(function () {
      state.matches[row.key] = { name: row.name, catalogId: row.catalogId || '', eachFactor: eachFactor, hideMode: row.hideMode || '' };
      row.matchSaved = true;
      var hiddenNote = row.hideMode === 'ignore' ? 'Ignored — not ordered' : (row.hideMode === 'replace' ? 'Replaced — weight carries over' : '');
      var note = document.querySelector('[data-saved="' + index + '"]');
      if (note) note.textContent = 'Saved' + (hiddenNote ? ' · ' + hiddenNote : '');
      var tr = document.querySelector('tr[data-index="' + index + '"]');
      if (tr) {
        tr.className = (row.catalogId ? '' : 'unmatched') + (row.hideMode ? ' ingredient-hidden' : '');
        tr.hidden = !!(row.hideMode && !state.showHiddenIngredients);
      }
      var button = document.querySelector('[data-open="' + index + '"]');
      if (button) button.textContent = choiceLabel(row.catalogId ? state.catalog.items[row.catalogId] : null);
      updateMatchCount();
      markSaved();
    });
  }

  function approveRecipe() {
    var pending = ZedOrder.claimApproval(state);
    if (!pending) return;
    (pending.purchases || []).forEach(function (row, index) {
      var factorEl = document.querySelector('[data-factor="' + index + '"]');
      if (factorEl) row.eachFactor = factorEl.value === '' ? '' : Number(factorEl.value);
    });
    var button = document.getElementById('approveRecipe');
    if (button) {
      button.disabled = true;
      if (button.blur) button.blur();
    }
    var fileCook = ZedOrder.recipeWeek(pending.cookDate);
    if (!fileCook) {
      state.approvingRecipe = false;
      state.pendingRecipe = pending;
      setPageStatus('That recipe has no cook date, so nothing was saved.', true);
      return;
    }
    var mismatch = ZedBek.recipeCycleWarning(fileCook, state.weekKey);
    if (mismatch) {
      state.approvingRecipe = false;
      state.pendingRecipe = pending;
      setPageStatus(mismatch, true);
      renderRecipeReview();
      return;
    }
    var week = state.weekKey;
    var plan = ZedOrder.planRecipeApproval(pending.purchases, week);
    setPageStatus('Saving recipe needs for ' + ZedBek.shortDate(week) + '…');
    renderRecipeReview();
    ZedStorage.saveRecipeApproval(db, plan).then(function () {
      Object.keys(plan.matches).forEach(function (key) { state.matches[key] = plan.matches[key]; });
      return reload();
    }).then(function () {
      markSaved();
      setPageStatus('Recipe needs saved for ' + ZedBek.formatCycle(week) + '.');
    }).catch(function (err) {
      state.approvingRecipe = false;
      state.pendingRecipe = pending;
      showError(err);
      renderRecipeReview();
    }).then(function () {
      state.approvingRecipe = false;
    });
  }

  function onRecipeFile(file) {
    if (!file) return;
    state.recipeFileName = file.name;
    setRecipeStatus('Chosen: ' + file.name + '. Reading the file…');
    var reader = new FileReader();
    reader.onerror = function () {
      setRecipeStatus('Chosen: ' + file.name + '. Could not read that file. Try again.');
    };
    reader.onload = function () {
      setRecipeStatus('Chosen: ' + file.name + '. Parsing…');
      ZedRecipePdf.parseRecipePdf(new Uint8Array(reader.result), function (info) {
        if (info.phase === 'page') setRecipeStatus('Chosen: ' + file.name + '. Reading page ' + info.page + ' of ' + info.pages + '…');
        else if (info.phase === 'parse') setRecipeStatus('Chosen: ' + file.name + '. Adding up raw ingredients…');
      }).then(function (parsed) {
        state.pendingRecipe = parsed;
        var panel = document.getElementById('recipePanel');
        if (panel) panel.removeAttribute('data-built');
        setRecipeStatus('Done. ' + file.name + ' — ' + parsed.purchases.length + ' raw ingredients. Review the matches below.');
        renderRecipeReview();
      }).catch(function (err) {
        setRecipeStatus('Chosen: ' + file.name + '. ' + ((err && err.message) || 'Could not parse that PDF.'));
        showError(err);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  document.getElementById('itemTable').addEventListener('input', function (event) {
    var input = event.target;
    if (!input.dataset || !input.dataset.hand) return;
    var id = input.dataset.hand;
    var raw = input.value.trim();
    ZedStorage.setOnHand(db, state.locationId, state.weekKey, id, raw === '' ? null : raw).then(function () {
      if (!state.hands[state.locationId]) state.hands[state.locationId] = {};
      if (raw === '') {
        delete state.onHand[id];
        delete state.hands[state.locationId][id];
      } else {
        state.onHand[id] = Number(raw);
        state.hands[state.locationId][id] = Number(raw);
      }
      var cell = input.parentElement && input.parentElement.nextElementSibling;
      var row = null;
      state.rows.forEach(function (candidate) { if (candidate.id === id) row = candidate; });
      if (cell && row) {
        var cases = casesFor(row, currentStore());
        cell.textContent = cases > 0 ? cases + ' cs' : '0';
      }
      var mealInput = document.querySelector('[data-meal-hand="' + id + '"]');
      if (mealInput && mealInput !== input) mealInput.value = raw;
      var typeId = mealInput && mealInput.getAttribute('data-meal-type');
      if (typeId) {
        var mealOrder = document.querySelector('[data-meal-order="' + typeId + '"]');
        var mealPallet = document.querySelector('[data-meal-pallet="' + typeId + '"]');
        var mealLine = ZedMeals.orderLine(typeId, (function () {
          var summary = plateSummaryNow();
          return summary ? ZedMeals.unitsFor(ZedMeals.typeOf(typeId), summary) : 0;
        })(), raw === '' ? 0 : Number(raw), state.caseSizes[typeId]);
        if (mealOrder && mealLine) mealOrder.textContent = mealLine.cases + ' cs';
        if (mealPallet && mealLine) {
          mealPallet.textContent = mealLine.onBekOrder
            ? (mealLine.orderNeeded ? 'On the BEK order' : 'On the BEK order · no cases')
            : (mealLine.orderNeeded ? 'Pallet order needed' : 'No pallet order');
        }
      }
      markSaved();
    }).catch(showError);
  });
  document.getElementById('itemTable').addEventListener('change', function (event) {
    var input = event.target;
    if (!input.getAttribute || input.getAttribute('data-par') == null) return;
    var id = input.getAttribute('data-par');
    var row = null;
    state.rows.forEach(function (candidate) { if (candidate.id === id) row = candidate; });
    if (!row) return;
    var note = document.querySelector('[data-par-note="' + id + '"]');
    var raw = String(input.value || '').trim();
    var value = Number(raw);
    if (raw === '' || !isFinite(value) || value < 0) {
      if (note) note.textContent = 'Enter a number, or 0.';
      setPageStatus('Enter a standing par of zero or more for ' + row.item.name + '.', true);
      return;
    }
    var record = { value: value, unit: row.item.countUnit || '' };
    ZedStorage.setPar(db, state.locationId, row.id, record).then(function () {
      if (!state.allPars[state.locationId]) state.allPars[state.locationId] = {};
      state.allPars[state.locationId][row.id] = record;
      state.pars[row.id] = record;
      if (note) note.textContent = 'Saved';
      var tr = input.closest('tr');
      var needCell = tr && tr.querySelector('[data-need-for="' + id + '"]');
      var orderCell = tr && tr.querySelector('.need-order');
      var loc = currentStore();
      if (needCell) needCell.textContent = needLabel(needFor(row, loc));
      if (orderCell) {
        var cases = casesFor(row, loc);
        orderCell.textContent = cases > 0 ? cases + ' cs' : '0';
      }
      renderSummary(loc);
      markSaved();
    }).catch(function (err) {
      if (note) note.textContent = (err && err.message) || 'Could not save that par.';
      showError(err);
    });
  });
  document.getElementById('itemTable').addEventListener('click', function (event) {
    var roleBtn = event.target.closest('[data-order-role]');
    if (!roleBtn) return;
    var id = roleBtn.getAttribute('data-order-role');
    var item = state.catalog.items[id];
    if (!item) {
      setPageStatus('That item is not in the catalog, so the food or supply choice cannot be saved.', true);
      return;
    }
    var next = ZedOrder.isFoodItem(item) ? 'supply' : 'food';
    ZedStorage.setItemFields(db, id, { orderRole: next }).then(function () {
      item.orderRole = next;
      setPageStatus('Saved. ' + item.name + ' is ' + (next === 'food' ? 'food from the scaled recipe' : 'a supply with a standing par') + '.');
      render();
    }).catch(showError);
  });
  document.getElementById('storePanel').addEventListener('change', function (event) {
    var box = event.target;
    if (box.dataset && box.dataset.store) {
      var next = ZedLocations.withRole(state.locationDoc, box.dataset.store, box.dataset.role, box.checked);
      var loc = next.locations[box.dataset.store];
      if (box.dataset.role === 'isProductionHub') loc.listSource = box.checked ? 'catalog' : loc.listSource;
      state.locationDoc[loc.id] = loc;
      ZedStorage.setLocation(db, loc).then(function () { fillStores(); reload(); }).catch(showError);
    }
    if (box.dataset && box.dataset.source) {
      var id = box.dataset.source;
      var store = state.locationDoc[id];
      if (!store) return;
      store.listSource = box.value === 'catalog' ? 'catalog' : 'inventory';
      ZedStorage.setLocation(db, store).then(function () { reload(); }).catch(showError);
    }
  });
  document.getElementById('locationSelect').addEventListener('change', function () {
    state.locationId = this.value;
    try { localStorage.setItem('zedops_weekly_store', state.locationId); } catch (e) {}
    reload();
  });
  document.getElementById('weekSelect').addEventListener('change', function () {
    var picked = ZedBek.selectCookDate(this.value || ZedBek.openCookDate(ZedBek.chicagoParts(new Date()).ymd));
    if (this.value !== picked) this.value = picked;
    if (picked === state.weekKey) {
      syncRecipeWarning();
      render();
      return;
    }
    state.weekKey = picked;
    reload();
  });
  document.getElementById('showStore').addEventListener('click', function () { showView('store'); });
  document.getElementById('showOrder').addEventListener('click', function () { showView('order'); });
  document.getElementById('recipeFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    onRecipeFile(file);
  });
  document.getElementById('plateFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    onPlateFile(file);
  });
  function onPackChoice(select) {
    var key = select.getAttribute('data-pack-dish');
    var name = select.getAttribute('data-pack-name') || '';
    var packId = select.value === 'cup_9oz' ? 'cup_9oz' : 'meal_container';
    ZedStorage.setPackChoice(db, key, { name: name, packId: packId }).then(function () {
      state.packChoices[key] = { name: name, packId: packId };
      setPageStatus('Saved. ' + name + ' uses ' + ZedMeals.packLabel(packId) + '.');
      renderPlateReview();
      renderMealChecks(currentStore());
      markSaved();
    }).catch(showError);
  }
  document.getElementById('platePanel').addEventListener('change', function (event) {
    var select = event.target;
    if (!select.getAttribute || select.getAttribute('data-pack-dish') == null) return;
    onPackChoice(select);
  });
  document.getElementById('mealChecks').addEventListener('change', function (event) {
    var input = event.target;
    if (input.getAttribute && input.getAttribute('data-pack-dish') != null) {
      onPackChoice(input);
      return;
    }
    if (input.getAttribute && input.getAttribute('data-case-size') != null) {
      var supplyId = input.getAttribute('data-case-size');
      var size = Number(input.value);
      if (!(size > 0)) {
        setPageStatus('Enter a case size greater than zero.', true);
        return;
      }
      ZedStorage.setCaseSize(db, supplyId, size).then(function () {
        state.caseSizes[supplyId] = size;
        setPageStatus('Saved');
        renderMealChecks(currentStore());
        markSaved();
      }).catch(showError);
      return;
    }
    if (!input.getAttribute || input.getAttribute('data-meal-hand') == null) return;
    var id = input.getAttribute('data-meal-hand');
    var typeId = input.getAttribute('data-meal-type') || id;
    var raw = String(input.value || '').trim();
    var value = Number(raw);
    if (raw !== '' && (!isFinite(value) || value < 0)) {
      setPageStatus('Enter a container count of zero or more.', true);
      return;
    }
    ZedStorage.setOnHand(db, state.locationId, state.weekKey, id, raw === '' ? null : value).then(function () {
      if (!state.hands[state.locationId]) state.hands[state.locationId] = {};
      if (raw === '') {
        delete state.onHand[id];
        delete state.hands[state.locationId][id];
      } else {
        state.onHand[id] = value;
        state.hands[state.locationId][id] = value;
      }
      var summary = packagingSummary(plateDishList(state.plate), state.plate ? state.plate.totalCook : 0);
      var needs = { meal_container: summary.containers, cup_9oz: summary.cup, lid_9oz: summary.cup };
      var line = ZedMeals.orderLine(typeId, needs[typeId], Number(state.onHand[id]), state.caseSizes[typeId]);
      var orderCell = document.querySelector('[data-meal-order="' + typeId + '"]');
      var palletCell = document.querySelector('[data-meal-pallet="' + typeId + '"]');
      if (orderCell && line) orderCell.textContent = line.cases + ' cs';
      if (palletCell && line) {
        palletCell.textContent = line.orderBy === 'pallet'
          ? (line.orderNeeded ? 'Pallet order needed' : 'No pallet order')
          : (line.orderNeeded ? 'Case order needed' : 'No order');
      }
      setPageStatus('Saved');
      markSaved();
    }).catch(showError);
  });
  document.getElementById('recipePanel').addEventListener('click', function (event) {
    var open = event.target.closest('[data-open]');
    if (open) {
      var index = open.getAttribute('data-open');
      var pop = document.querySelector('[data-pop="' + index + '"]');
      var willOpen = pop.hidden;
      closeMatchPops();
      if (willOpen) {
        pop.hidden = false;
        open.setAttribute('aria-expanded', 'true');
        fillMatchList(index, '');
        var search = pop.querySelector('input');
        if (search) search.focus();
      }
      return;
    }
    var hideRow = event.target.closest('[data-hide-row]');
    if (hideRow) {
      var hidePanel = document.querySelector('[data-hide-panel="' + hideRow.getAttribute('data-hide-row') + '"]');
      if (hidePanel) hidePanel.hidden = false;
      return;
    }
    var cancelHide = event.target.closest('[data-cancel-hide]');
    if (cancelHide) {
      var cancelPanel = document.querySelector('[data-hide-panel="' + cancelHide.getAttribute('data-cancel-hide') + '"]');
      if (cancelPanel) cancelPanel.hidden = true;
      return;
    }
    var applyHide = event.target.closest('[data-apply-hide]');
    if (applyHide) {
      var applyIndex = applyHide.getAttribute('data-apply-hide');
      var applyRow = state.pendingRecipe.purchases[applyIndex];
      var checked = document.querySelector('input[name="hide-mode-' + applyIndex + '"]:checked');
      var plan = ZedOrder.planIngredientHide(applyRow, {
        mode: checked ? checked.value : 'replace',
        catalogId: applyRow.catalogId
      });
      if (!plan.ok) { setPageStatus(plan.error + ' Replace is the default so the weight is not dropped.', true); return; }
      applyRow.hideMode = plan.hideMode;
      applyRow.catalogId = plan.catalogId;
      saveMatch(applyIndex).then(function () {
        var tr = document.querySelector('tr[data-index="' + applyIndex + '"]');
        if (tr) {
          tr.classList.add('ingredient-hidden');
          tr.hidden = !state.showHiddenIngredients;
        }
        var panel = document.querySelector('[data-hide-panel="' + applyIndex + '"]');
        if (panel) panel.hidden = true;
        var note = document.querySelector('[data-saved="' + applyIndex + '"]');
        if (note) note.textContent = 'Saved · ' + (plan.hideMode === 'ignore' ? 'Ignored — not ordered' : 'Replaced — weight carries over');
        var btn = tr && tr.querySelector('[data-hide-row]');
        if (btn) {
          btn.textContent = 'Unhide';
          btn.removeAttribute('data-hide-row');
          btn.setAttribute('data-unhide-row', applyIndex);
        }
      }).catch(showError);
      return;
    }
    var unhideRow = event.target.closest('[data-unhide-row]');
    if (unhideRow) {
      var unhideIndex = unhideRow.getAttribute('data-unhide-row');
      var unhide = state.pendingRecipe.purchases[unhideIndex];
      unhide.hideMode = '';
      saveMatch(unhideIndex).then(function () {
        var tr = document.querySelector('tr[data-index="' + unhideIndex + '"]');
        if (tr) {
          tr.classList.remove('ingredient-hidden');
          tr.hidden = false;
        }
        unhideRow.textContent = 'Hide';
        unhideRow.removeAttribute('data-unhide-row');
        unhideRow.setAttribute('data-hide-row', unhideIndex);
        var note = document.querySelector('[data-saved="' + unhideIndex + '"]');
        if (note) note.textContent = 'Saved';
      }).catch(showError);
      return;
    }
    var hideCatalog = event.target.closest('[data-hide-catalog], [data-unhide-catalog]');
    if (hideCatalog) {
      event.preventDefault();
      event.stopPropagation();
      var hideId = hideCatalog.getAttribute('data-hide-catalog') || hideCatalog.getAttribute('data-unhide-catalog');
      var hiding = !!hideCatalog.getAttribute('data-hide-catalog');
      ZedStorage.setMatchHidden(db, hideId, hiding).then(function () {
        if (hiding) state.catalogHidden[hideId] = true;
        else delete state.catalogHidden[hideId];
        document.querySelectorAll('.match-pop:not([hidden])').forEach(function (pop) {
          var search = pop.querySelector('input[type="search"]');
          fillMatchList(pop.getAttribute('data-pop'), search ? search.value : '');
        });
        markSaved();
      }).catch(showError);
      return;
    }
    var option = event.target.closest('.match-pop li');
    if (option && !event.target.closest('button')) {
      var list = option.parentElement;
      var matchIndex = list.getAttribute('data-list');
      var row = state.pendingRecipe.purchases[matchIndex];
      row.catalogId = option.getAttribute('data-id') || '';
      row.matchSaved = false;
      closeMatchPops();
      saveMatch(matchIndex).catch(showError);
    }
  });
  document.getElementById('recipePanel').addEventListener('change', function (event) {
    if (event.target.id === 'showHiddenIngredients') {
      state.showHiddenIngredients = event.target.checked;
      document.querySelectorAll('tr.ingredient-hidden').forEach(function (tr) {
        tr.hidden = !state.showHiddenIngredients;
      });
      return;
    }
    var showCatalog = event.target.getAttribute && event.target.getAttribute('data-show-hidden-catalog');
    if (showCatalog != null) {
      state.showHiddenCatalog = event.target.checked;
      var search = document.querySelector('[data-search="' + showCatalog + '"]');
      fillMatchList(showCatalog, search ? search.value : '');
    }
  });
  document.getElementById('recipePanel').addEventListener('input', function (event) {
    var search = event.target;
    if (search.getAttribute && search.getAttribute('data-search') != null) {
      fillMatchList(search.getAttribute('data-search'), search.value);
      return;
    }
    var factor = event.target.getAttribute && event.target.getAttribute('data-factor');
    if (factor == null) return;
    clearTimeout(search._factorTimer);
    search._factorTimer = setTimeout(function () {
      var row = state.pendingRecipe && state.pendingRecipe.purchases[factor];
      if (!row) return;
      row.eachFactor = search.value === '' ? '' : Number(search.value);
      saveMatch(factor).catch(showError);
    }, 400);
  });
  document.addEventListener('click', function (event) {
    if (!event.target.closest('.match-box')) closeMatchPops();
  });
  document.getElementById('guideFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      ZedXlsx.parseXlsx(new Uint8Array(reader.result)).then(function (matrix) {
        var parsed = ZedBek.rowsFromMatrix(matrix);
        state.pendingGuide = { diff: ZedBek.diffUpload(state.catalog, parsed) };
        var diff = state.pendingGuide.diff;
        var panel = document.getElementById('guidePanel');
        panel.style.display = 'block';
        panel.innerHTML = '<h2>Guide changes</h2><p>Added ' + diff.added.length + ', dropped ' + diff.dropped.length + ', moved ' + diff.moved.length +
          ', price up ' + diff.priceUp.length + ', price down ' + diff.priceDown.length + ', substitutions ' + diff.substitutions.length + '.</p>' +
          '<button type="button" id="approveGuide">Approve guide</button> <button type="button" id="discardGuide">Discard</button>';
        document.getElementById('approveGuide').onclick = function () {
          ZedStorage.applyWrites(db, ZedBek.planUpload(state.catalog, diff)).then(function () {
            state.pendingGuide = null;
            panel.style.display = 'none';
            return db.ref(ZedStorage.PATHS.catalog).once('value');
          }).then(function (snap) {
            var raw = snap.val() || {};
            state.catalog = ZedSchema.migrateCatalog({ schemaVersion: raw.schemaVersion || 1, items: raw.items || {}, shelf: raw.shelf || {} });
            reload();
          }).catch(showError);
        };
        document.getElementById('discardGuide').onclick = function () { state.pendingGuide = null; panel.style.display = 'none'; };
      }).catch(showError);
    };
    reader.readAsArrayBuffer(file);
  });
  function bekOrderLines() {
    var lines = [ZedBek.formatCycle(state.weekKey), 'Food need is the approved scaled recipe. Cups and lids from the plate list are included. Meal containers are not. Cases round up.', ''];
    var list = stores();
    ZedCatalog.asList(state.catalog.shelf.guide).concat(ZedCatalog.asList(state.catalog.shelf.special)).forEach(function (id) {
      var item = state.catalog.items[id];
      if (!item || !ZedBek.isShown(item) || item.kind === 'vendor_check') return;
      var parts = list.map(function (loc) {
        var row = { id: id, item: item, legacyKey: '', source: 'guide' };
        return loc.name + ' ' + needLabel(needFor(row, loc)) + ', order ' + casesFor(row, loc);
      });
      lines.push((item.itemNumber || 'no BEK #') + ' ' + item.name + ' | ' + parts.join(' | '));
    });
    return lines;
  }
  document.getElementById('pdfOrder').addEventListener('click', function () {
    ZedPdf.downloadPdf('bek-order-' + state.weekKey + '.pdf', ZedPdf.buildPdf({ title: 'Weekly BEK order', lines: bekOrderLines() }));
  });
  document.getElementById('pdfSpecial').addEventListener('click', function () {
    var lines = ['Send this list direct to the BEK rep.', ZedBek.formatCycle(state.weekKey), 'Food on this list uses the approved scaled recipe, not the BEK par.', ''];
    state.rows.filter(function (row) { return row.source === 'special'; }).forEach(function (row) {
      var hand = handOf(row);
      lines.push((row.item.temporary ? '[TEMPORARY] ' : '') + row.item.name + (row.item.itemNumber ? ' #' + row.item.itemNumber : ' (no BEK #)') +
        ' | ' + needLabel(needFor(row)) + ' | order ' + casesFor(row) +
        ' | on hand ' + (hand == null ? 'not counted' : hand + ' ' + (row.item.countUnit || '')));
    });
    ZedPdf.downloadPdf('bek-special-order-' + state.weekKey + '.pdf', ZedPdf.buildPdf({ title: 'Special order — send direct to the BEK rep', lines: lines }));
  });

  function showApp(role) {
    state.role = role || 'team';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
    document.getElementById('roleBadge').textContent = state.role === 'admin' ? 'Admin' : 'Team';
    state.weekKey = ZedBek.openCookDate(ZedBek.chicagoParts(new Date()).ymd);
    document.getElementById('weekSelect').value = state.weekKey;
    ZedBek.loadSeed().then(function (seed) { return ZedBek.prepareDatabase(db, seed); }).then(function (moves) {
      if (moves && moves.length) {
        var shown = moves.slice(0, 4).map(function (move) {
          return move.kind + ' ' + move.from + ' is now cook date ' + move.to;
        }).join('. ');
        setPageStatus('Saved weeks now use the cook date. ' + shown + (moves.length > 4 ? '. And ' + (moves.length - 4) + ' more.' : '.'));
      }
      return null;
    }).then(function () {
      return Promise.all([
        db.ref(ZedStorage.PATHS.catalog).once('value'),
        db.ref(ZedStorage.PATHS.locations).once('value')
      ]);
    }).then(function (snaps) {
      var raw = snaps[0].val() || {};
      state.catalog = ZedSchema.migrateCatalog({ schemaVersion: raw.schemaVersion || 1, items: raw.items || {}, shelf: raw.shelf || {} });
      state.locationDoc = snaps[1].val() || {};
      fillStores();
      return reload();
    }).catch(showError);
  }

  document.getElementById('pin-input').addEventListener('input', function () {
    var input = this;
    document.getElementById('pin-error').textContent = '';
    if (input.value.length !== 4) return;
    var pin = input.value;
    input.disabled = true;
    HubAuth.signInWithPin(pin).then(showApp).catch(function (err) {
      document.getElementById('pin-error').textContent = HubAuth.friendlyError(err);
      input.value = '';
    }).then(function () { input.disabled = false; });
  });
  HubAuth.restore().then(function (role) { if (role) showApp(role); });
})();
