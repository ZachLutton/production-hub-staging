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
    piecesPerCup: {},
    plateLinks: {},
    standards: {},
    cook: null,
    pendingCook: null,
    cookMap: {},
    cookBusy: false,
    orderConfirmed: false,
    caseSizes: {},
    matches: {},
    catalogHidden: {},
    showHiddenIngredients: false,
    showHiddenCatalog: false,
    pendingRecipe: null,
    allowRecipeMismatch: false,
    recipeBusy: false,
    plateBusy: false,
    recipeFileName: '',
    plateFileName: '',
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
  function requireAdmin() {
    if (state.role === 'admin') return true;
    setPageStatus('Only an admin can change that. On-hand counts are the entry for this login.', true);
    return false;
  }
  function explainSaveError(err) {
    var code = String(err && err.code || '');
    var message = String(err && err.message || '');
    if (code === 'PERMISSION_DENIED' || /PERMISSION_DENIED|permission denied/i.test(message)) {
      return 'Save blocked. Firebase project zedops-staging rejected this write. Publish database.rules.staging.json there (Realtime Database, Rules, paste the file, Publish). Do not open the live Production Hub project.';
    }
    return message || 'Could not save that change.';
  }
  function showError(err) {
    console.error(err);
    var text = explainSaveError(err);
    setPageStatus(text, true);
    var el = document.getElementById('pageStatus');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  }
  function itemIdForInventory(item) {
    if (item.itemNumber) return ZedCatalog.catalogId('bek', item.itemNumber);
    return 'inv__' + ZedRecipe.nameKey(item.name || 'item');
  }
  function catalogItem(id) {
    return state.catalog.items[id] || null;
  }

  var RIM_GUIDE_SEED = 'rim-live-1';
  function loadLocationTables() {
    return fetch('zedops/weekly-location-items.json').then(function (response) {
      if (!response.ok) throw new Error('Could not load the store item list.');
      return response.json();
    });
  }
  function ensureInventory(loc) {
    var monthlyId = loc.monthlyLocationId || loc.id;
    var ref = db.ref('staging_inventory/' + monthlyId + '/items');
    return ref.once('value').then(function (snap) {
      var current = snap.val();
      if (monthlyId !== 'rim' && monthlyId !== 'main') return current || {};
      if (monthlyId !== 'rim' && !ZedWeekly.itemsNodeEmpty(current)) return current;
      return loadLocationTables().then(function (tables) {
        var payload = tables[monthlyId];
        if (!payload) return current || {};
        if (monthlyId !== 'rim') {
          return ref.transaction(function (existing) {
            return ZedWeekly.itemsNodeEmpty(existing) ? payload : undefined;
          }).then(function () { return ref.once('value'); }).then(function (again) { return again.val() || payload; });
        }
        var versionRef = db.ref('staging_inventory/rim/itemsSeed');
        return versionRef.once('value').then(function (versionSnap) {
          if (versionSnap.val() === RIM_GUIDE_SEED && !ZedWeekly.itemsNodeEmpty(current)) return current;
          return ref.set(payload).then(function () {
            return versionRef.set(RIM_GUIDE_SEED);
          }).then(function () { return payload; });
        });
      });
    });
  }
  function seedRimPars() {
    if (state.role !== 'admin') return Promise.resolve();
    return fetch('zedops/rim-pars-seed.json').then(function (response) {
      if (!response.ok) return null;
      return response.json();
    }).then(function (seed) {
      if (!seed || !seed.length) return null;
      return db.ref(ZedStorage.PATHS.pars + '/rim').once('value').then(function (snap) {
        var existing = snap.val() || {};
        var jobs = [];
        seed.forEach(function (row) {
          if (!row || !row.id || existing[row.id]) return;
          jobs.push(ZedStorage.setPar(db, 'rim', row.id, { value: row.value, unit: row.unit }));
        });
        return Promise.all(jobs);
      });
    }).catch(showError);
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
              var shown = {
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
              };
              if (known && known.name) {
                shown = Object.assign({}, known);
                if (!shown.label) shown.label = section;
                shown.name = shown.name || item.name || '';
                shown.pack = shown.pack || item.pack || '';
                shown.brand = shown.brand || item.brand || '';
              }
              if (known && known.orderRole) shown.orderRole = known.orderRole;
              if (known && Number(known.lbPerUnit) > 0) shown.lbPerUnit = Number(known.lbPerUnit);
              if (item.countUnit) {
                shown.countUnit = item.countUnit;
                shown.countUnitChosen = true;
              }
              if (known && known.countUnitChosen && known.countUnit) {
                shown.countUnit = known.countUnit;
                shown.countUnitChosen = true;
              }
              if (Number(item.eachPerCase) > 0) shown.eachPerCase = Number(item.eachPerCase);
              rows.push({
                id: id,
                item: shown,
                legacyKey: ZedWeekly.getItemKey(section, item, ZedWeekly.itemIndex(item, index)),
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
    if (saved) return Number(saved.value) || 0;
    if (row.item && ZedOrder.isPortionPacket(row.item)) return 1;
    return 0;
  }
  function recipeNeed(item) {
    var found = ZedOrder.recipeLineFor(item, state.recipe);
    if (!found) return null;
    return { quantity: found.pounds, unit: found.unit || 'lb', eachFactor: found.eachFactor };
  }
  function plateSummaryNow() {
    if (!state.plate || !(Number(state.plate.totalCook) >= 0)) return null;
    return packagingSummary(plateDishList(state.plate), state.plate.totalCook);
  }
  function cookComponents(cook) {
    if (!cook || !cook.components) return [];
    if (Array.isArray(cook.components)) return cook.components;
    return Object.keys(cook.components).map(function (key) {
      var row = cook.components[key] || {};
      return { key: key, name: row.name || key, quantity: Number(row.quantity) || 0, unit: row.unit || 'ea' };
    });
  }
  function cookListFor(item, loc) {
    if (!item || !state.cook) return null;
    var found = ZedCook.piecesForItem(item, cookComponents(state.cook), state.cookMap);
    if (!found) return null;
    var onHub = loc && ZedLocations.listSourceOf(loc) === 'catalog';
    return { quantity: onHub ? found.quantity : 0, unit: 'each', reason: onHub ? found.reasons.join('; ') : '' };
  }
  function plateListFor(item, loc) {
    if (!item) return null;
    var dishes = plateDishList(state.plate);
    var saved = state.plateLinks ? state.plateLinks[item.id] : null;
    var pieces = ZedMeals.plateItemPieces(item, dishes, saved && typeof saved === 'object' ? saved : null);
    if (pieces != null) {
      var onHubItem = loc && ZedLocations.listSourceOf(loc) === 'catalog';
      var linked = ZedMeals.plateItemRows(item, dishes, saved && typeof saved === 'object' ? saved : null);
      var reason = onHubItem ? linked.map(function (row) {
        return row.count + ' ' + row.name + ' × ' + row.qty;
      }).join('; ') : '';
      return { quantity: onHubItem ? pieces : 0, unit: 'each', reason: reason };
    }
    var type = ZedMeals.typeForItemNumber(item.itemNumber);
    if (!type || !type.catalogNumber) return null;
    var onHub = loc && ZedLocations.listSourceOf(loc) === 'catalog';
    var summary = state.plate ? packagingSummary(plateDishList(state.plate), state.plate.totalCook) : null;
    var reason = onHub ? ZedMeals.cupNeedReason(state.plate, summary) : '';
    var units = onHub && summary && !reason ? ZedMeals.unitsFor(type, summary) : 0;
    return { quantity: units, unit: 'each', reason: reason };
  }
  function garnishFor(item) {
    if (!item || !window.ZedGarnish) return null;
    return ZedGarnish.forItem(item, plateDishList(state.plate));
  }
  function pendingPounds(item) {
    if (!item || !state.pendingRecipe) return 0;
    var qty = 0;
    (state.pendingRecipe.purchases || []).forEach(function (row) {
      if (row.hideMode === 'ignore' || row.catalogId !== item.id) return;
      qty += Number(row.pounds) || 0;
    });
    return qty;
  }
  function needFor(row, loc) {
    loc = loc || currentStore();
    var onHub = loc && ZedLocations.listSourceOf(loc) === 'catalog';
    var supplyChoice = row.item && row.item.orderRole === 'supply';
    var recipe = onHub && !supplyChoice ? recipeNeed(row.item) : null;
    var pending = onHub && !supplyChoice ? pendingPounds(row.item) : 0;
    if (pending > 0 && (!recipe || pending > (Number(recipe.quantity) || 0))) {
      recipe = { quantity: pending, unit: 'lb', eachFactor: null };
    }
    var garnish = onHub && !supplyChoice ? garnishFor(row.item) : null;
    if (garnish && garnish.pounds > 0) {
      var already = recipe ? Number(recipe.quantity) || 0 : 0;
      recipe = {
        quantity: already + garnish.pounds,
        unit: 'lb',
        eachFactor: null,
        source: already > 0 ? 'recipe' : 'plate garnish',
        reason: garnish.reason
      };
    }
    var retail = ZedOrder.isRetailResale(Object.assign({}, row.item, { label: row.item.label || row.section }));
    var fromRecipe = !supplyChoice && !retail && !!(recipe && Number(recipe.quantity) > 0);
    var packet = ZedOrder.isPortionPacket(row.item);
    return ZedOrder.orderNeed(row.item, {
      cookList: supplyChoice ? null : cookListFor(row.item, loc),
      plateList: supplyChoice ? null : plateListFor(row.item, loc),
      recipe: supplyChoice || packet ? null : recipe,
      standingPar: (packet || !(fromRecipe || ZedOrder.isFoodItem(row.item))) ? parOf(row, loc) : 0,
      countUnit: ZedOrder.resolvedCountUnit(row.item),
      forceFood: fromRecipe && !packet
    });
  }
  function recipeUsesItem(item) {
    var recipe = recipeNeed(item);
    if (recipe && Number(recipe.quantity) > 0) return true;
    return pendingPounds(item) > 0;
  }
  function needLabel(need) {
    var text = ZedOrder.needText(need) + ' · ' + need.source;
    if (need.reason) text += ' — ' + need.reason;
    return text;
  }
  function orderFor(row, loc) {
    var need = needFor(row, loc);
    if (!need) return { amount: 0, unit: 'cs' };
    if (need.source === 'plate list' && !(row.item && ZedOrder.isCaseCountedPackaging(row.item))) {
      var type = ZedMeals.typeForItemNumber(row.item && row.item.itemNumber);
      if (type) {
        var size = Number(state.caseSizes[type.id]) > 0 ? Number(state.caseSizes[type.id]) : type.caseSize;
        var fromPack = ZedOrder.packAmount(row.item && row.item.pack);
        if (!(size > 0) && fromPack) size = fromPack.perCase;
        return { amount: ZedOrder.casesToOrder(need.quantity, handOf(row, loc) || 0, size || 1), unit: 'cs' };
      }
    }
    return ZedOrder.orderResult(row.item, need, handOf(row, loc));
  }
  function orderLabel(result) {
    if (!result || !(Number(result.amount) > 0)) return '0';
    return result.amount + (result.unit === 'ea' ? ' ea' : ' cs');
  }
  function handLabel(row, loc) {
    var hand = handOf(row, loc);
    var unit = ZedOrder.unitLabel(ZedOrder.resolvedCountUnit(row.item));
    if (hand == null || hand === '') return '—';
    return hand + (unit ? ' ' + unit : '');
  }
  function needBlock(row, loc) {
    var need = needFor(row, loc);
    var math = ZedOrder.orderExplain(row.item, need, handOf(row, loc));
    return '<div class="need-main">' + esc(needLabel(need)) + '</div><div class="need-math">' + esc(math) + '</div>';
  }
  function casesFor(row, loc) {
    var ordered = orderFor(row, loc);
    return ordered.unit === 'cs' ? ordered.amount : 0;
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
        var repaired = ZedPlate.deriveFromStored(state.plate);
        if (!repaired) return null;
        state.plate = repaired;
        return ZedStorage.setPlateTotal(db, week, repaired);
      }).then(function () {
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
        return db.ref(ZedStorage.PATHS.plate + '/link').once('value');
      }).then(function (linkSnap) {
        state.plateLinks = (linkSnap && linkSnap.val()) || {};
        return db.ref(ZedStorage.PATHS.plate + '/pieces').once('value');
      }).then(function (pieceSnap) {
        var saved = (pieceSnap && pieceSnap.val()) || {};
        var rates = {};
        Object.keys(saved).forEach(function (component) {
          if (saved[component] && Number(saved[component].piecesPerCup) > 0) rates[component] = Number(saved[component].piecesPerCup);
        });
        state.piecesPerCup = rates;
        return db.ref(ZedStorage.PATHS.standards).once('value');
      }).then(function (standardSnap) {
        state.standards = (standardSnap && standardSnap.val()) || {};
        ZedOrder.useStandards(state.standards);
        return db.ref(ZedStorage.PATHS.cook + '/' + week).once('value');
      }).then(function (cookSnap) {
        state.cook = (cookSnap && cookSnap.val()) || null;
        return db.ref(ZedStorage.PATHS.cook + '/map').once('value');
      }).then(function (cookMapSnap) {
        state.cookMap = (cookMapSnap && cookMapSnap.val()) || {};
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
                var key = ZedWeekly.getItemKey(section, item, ZedWeekly.itemIndex(item, index));
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
    var reason = document.getElementById('approveReason');
    if (reason) reason.textContent = text;
    var button = document.getElementById('approveRecipe');
    if (button) button.disabled = !!text;
    var anyway = document.getElementById('approveAnyway');
    if (anyway) anyway.hidden = !(text && state.role === 'admin');
    var confirmBox = document.getElementById('approveConfirm');
    if (confirmBox && !text) confirmBox.hidden = true;
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
      ZedOrder.useStandards(state.standards);
      renderRecipeTools();
      renderPlateReview();
      renderCookReview();
      renderMealChecks(loc);
      renderSummary(loc);
      if (state.view === 'order') renderOrder();
      else renderStore(loc);
      renderAdmin(loc);
      renderSavedUploads();
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
    return ZedMeals.tally(dishes, state.packChoices, totalCook, state.piecesPerCup);
  }

  function piecesPerCupFields() {
    var parts = ['cookie', 'chew', 'muffin'].map(function (component) {
      var value = ZedMeals.piecesPerCup(component, state.piecesPerCup);
      var label = component === 'cookie' ? 'Cookies' : (component === 'chew' ? 'Chews' : 'Muffins');
      if (state.role !== 'admin') return esc(value) + ' ' + label.toLowerCase();
      return '<label>' + label + ' <input data-pieces-per="' + component + '" type="number" min="1" step="1" aria-label="Pieces per cup for ' + label.toLowerCase() + '" value="' + esc(value) + '" style="width:70px;font-size:16px;min-height:44px"> per cup</label>';
    });
    if (state.role !== 'admin') return 'A 9 oz cup holds ' + parts.join(', ') + '.';
    return '<div class="cup-yield">Pieces per 9 oz cup: ' + parts.join(' ') + '</div>';
  }

  function packSelect(dish) {
    if (state.role !== 'admin') return esc(ZedMeals.packLabel(dish.packId));
    return '<select data-pack-dish="' + esc(dish.key) + '" data-pack-name="' + esc(dish.name) + '" aria-label="Packaging for ' + esc(dish.name) + '">' +
      '<option value="meal_container"' + (dish.packId === 'meal_container' ? ' selected' : '') + '>Meal container</option>' +
      '<option value="cup_9oz"' + (dish.packId === 'cup_9oz' ? ' selected' : '') + '>9 oz cup and lid</option></select>';
  }

  function linksOnDish(dish) {
    var out = [];
    var dishes = plateDishList(state.plate);
    var items = state.catalog && state.catalog.items ? state.catalog.items : {};
    Object.keys(items).forEach(function (id) {
      var item = items[id];
      var saved = state.plateLinks && state.plateLinks[id];
      var rows = ZedMeals.plateItemRows(item, dishes, saved && typeof saved === 'object' ? saved : null);
      rows.forEach(function (row) {
        if (row.key === dish.key) out.push({ itemId: id, itemNumber: item.itemNumber, name: item.name, qty: row.qty });
      });
    });
    return out;
  }

  function plateItemEditor(dish) {
    var links = linksOnDish(dish);
    if (state.role !== 'admin') {
      if (!links.length) return '';
      return '<div>' + links.map(function (link) {
        return esc(link.qty) + ' × BEK ' + esc(link.itemNumber) + ' ' + esc(link.name);
      }).join('<br>') + '</div>';
    }
    var rows = links.concat([{ itemNumber: '', qty: '', name: '' }]);
    return '<div class="plate-link-edit">' + rows.map(function (link, index) {
      return '<div><label>Item # <input data-plate-link-item="' + esc(dish.key) + '" data-plate-link-index="' + index + '" data-plate-link-name="' + esc(dish.name) + '" value="' + esc(link.itemNumber || '') + '" style="width:90px" aria-label="Plate item for ' + esc(dish.name) + '"></label> ' +
        '<label>per plate <input data-plate-link-qty="' + esc(dish.key) + '" data-plate-link-index="' + index + '" type="number" min="0" step="any" value="' + (link.qty === '' || link.qty == null ? '' : esc(link.qty)) + '" style="width:70px" aria-label="Per plate for ' + esc(dish.name) + '"></label> ' +
        esc(link.name || '') + '</div>';
    }).join('') + '</div>';
  }

  function materializeLinks(item) {
    var saved = state.plateLinks && state.plateLinks[item.id];
    if (saved && typeof saved === 'object') {
      var copy = {};
      Object.keys(saved).forEach(function (key) {
        if (saved[key] && Number(saved[key].qty) > 0) copy[key] = { name: saved[key].name || '', qty: Number(saved[key].qty) };
      });
      return copy;
    }
    var map = {};
    ZedMeals.defaultPlateItems(item, plateDishList(state.plate)).forEach(function (row) {
      map[row.key] = { name: row.name, qty: row.qty };
    });
    return map;
  }

  function savePlateItemLink(dishKey, dishName) {
    if (!requireAdmin()) return Promise.resolve();
    var wanted = {};
    document.querySelectorAll('[data-plate-link-item="' + dishKey + '"]').forEach(function (input) {
      var index = input.getAttribute('data-plate-link-index');
      var qtyEl = document.querySelector('[data-plate-link-qty="' + dishKey + '"][data-plate-link-index="' + index + '"]');
      var number = String(input.value || '').replace(/\D/g, '').replace(/^0+/, '');
      var amount = Number(qtyEl && qtyEl.value);
      if (number && amount > 0) wanted[number] = amount;
    });
    var jobs = [];
    var items = (state.catalog && state.catalog.items) || {};
    Object.keys(items).forEach(function (id) {
      var item = items[id];
      var map = materializeLinks(item);
      var had = Object.prototype.hasOwnProperty.call(map, dishKey);
      var itemNum = String(item.itemNumber || '').replace(/^0+/, '');
      if (wanted[itemNum] > 0) map[dishKey] = { name: dishName, qty: wanted[itemNum] };
      else if (had) delete map[dishKey];
      else return;
      jobs.push(ZedStorage.setPlateLink(db, id, map).then(function () {
        if (Object.keys(map).length) state.plateLinks[id] = map;
        else delete state.plateLinks[id];
      }));
    });
    return Promise.all(jobs);
  }

  function dishTable(summary, withLinks) {
    if (!summary.dishes.length) return '<p class="empty-state">This saved plate list has a Total Cook but no dish lines. Upload it again to split muffins and cookies from the trays.</p>';
    return '<table class="order-table"><thead><tr><th>Dish</th><th>Count</th><th>Packaging</th></tr></thead><tbody>' +
      summary.dishes.map(function (dish) {
        var cups = dish.cups > 0 ? '<div>' + esc(dish.cups) + ' cups · ' + esc(dish.perCup) + ' per cup</div>' : '';
        return '<tr><td>' + esc(dish.name) + '</td><td>' + esc(dish.count) + '</td><td>' + packSelect(dish) + cups + (withLinks ? plateItemEditor(dish) : '') + '</td></tr>';
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
    box.innerHTML = '<h2>Packaging</h2><p>Total Cook ' + esc(summary.totalCook) + ' for ' + esc(cook) + '. Meal trays ' + esc(summary.containers) + ' stay a pallet check. Cups and lids ' + esc(summary.cup) + ' go on the BEK order as plate list, not as a standing par. ' + piecesPerCupFields() + '</p>' +
      dishTable(summary, true) +
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
      (warn || ('Total Cook ' + esc(pending.totalCook) + ' for ' + esc(ZedBek.shortDate(pending.cookDate)) + '. ' + esc((pending.dishes || []).length) + ' dishes. Trays ' + esc(summary.containers) + '. Cups and lids ' + esc(summary.cup) + '. ' + piecesPerCupFields())) +
      '</p>' + dishTable(summary) + '<button type="button" id="approvePlate"' + (warn || !(pending.dishes || []).length ? ' disabled' : '') + '>Approve plate list</button> <button type="button" id="discardPlate">Discard</button>';
    var approve = document.getElementById('approvePlate');
    var discard = document.getElementById('discardPlate');
    if (approve) approve.onclick = approvePlate;
    if (discard) discard.onclick = function () {
      state.pendingPlate = null;
      renderPlateReview();
    };
  }

  function saveParsedPlate(parsed) {
    if (!parsed) return Promise.resolve();
    var warn = ZedBek.recipeCycleWarning(parsed.cookDate, state.weekKey);
    if (warn) {
      setPageStatus(warn, true);
      return Promise.resolve();
    }
    if (!(Number(parsed.totalCook) >= 0)) {
      setPageStatus('That plate list has no Total Cook, so nothing was saved.', true);
      return Promise.resolve();
    }
    if (!parsed.dishes || !parsed.dishes.length) {
      setPageStatus('That plate list has a Total Cook but no dish lines, so nothing was saved.', true);
      return Promise.resolve();
    }
    var button = document.getElementById('approvePlate');
    if (button) button.disabled = true;
    var approvedAt = new Date().toISOString();
    var summary = packagingSummary(parsed.dishes, parsed.totalCook);
    return ZedStorage.setPlateTotal(db, state.weekKey, {
      totalCook: parsed.totalCook,
      dishes: parsed.dishes,
      fileName: state.plateFileName || parsed.fileName || '',
      approvedAt: approvedAt,
      sourceText: parsed.sourceText || ''
    }).then(function () {
      var dishes = {};
      parsed.dishes.forEach(function (dish) {
        if (dish && dish.key && Number(dish.count) > 0) dishes[dish.key] = { name: dish.name, count: Number(dish.count) || 0 };
      });
      state.plate = {
        cookDate: state.weekKey,
        totalCook: Number(parsed.totalCook),
        dishes: dishes,
        fileName: state.plateFileName || parsed.fileName || '',
        approvedAt: approvedAt,
        sourceText: parsed.sourceText || ''
      };
      state.pendingPlate = null;
      setPageStatus('Plate list saved for ' + ZedBek.shortDate(state.weekKey) + '. ' + Object.keys(dishes).length + ' dishes. Cups and lids ' + summary.cup + '.');
      render();
      markSaved();
    }).catch(function (err) {
      if (button) button.disabled = false;
      showError(err);
      renderPlateReview();
    });
  }

  function approvePlate() {
    saveParsedPlate(state.pendingPlate);
  }

  function savedRecipeText() {
    var bag = state.recipe || {};
    var meta = bag._meta || {};
    var ingredients = Object.keys(bag).filter(function (key) {
      return key !== '_meta' && bag[key] && bag[key].name;
    }).length;
    if (!ingredients && !meta.fileName) return '';
    return ZedBek.savedUploadLine(meta.fileName, ingredients + ' ingredients', meta.approvedAt);
  }
  function savedPlateText() {
    var plate = state.plate;
    if (!plate || !(Number(plate.totalCook) >= 0)) return '';
    var dishes = plateDishList(plate);
    var summary = packagingSummary(dishes, plate.totalCook);
    var detail = 'Total Cook ' + plate.totalCook;
    if (dishes.length) detail += ' · ' + dishes.length + ' dishes · cups and lids ' + summary.cup;
    return ZedBek.savedUploadLine(plate.fileName, detail, plate.approvedAt);
  }
  function savedCookText() {
    var cook = state.cook;
    if (!cook || !cookComponents(cook).length && !cook.fileName) return '';
    var count = cookComponents(cook).length;
    var detail = count ? count + ' components' : '';
    return ZedBek.savedUploadLine(cook.fileName, detail, cook.approvedAt);
  }
  function renderSavedUploads() {
    if (!state.recipeBusy && !state.pendingRecipe) {
      var recipeStatus = document.getElementById('recipeStatus');
      if (recipeStatus) recipeStatus.textContent = savedRecipeText();
    }
    if (!state.plateBusy && !state.pendingPlate) {
      var plateStatus = document.getElementById('plateStatus');
      if (plateStatus) plateStatus.textContent = savedPlateText();
    }
    if (!state.cookBusy && !state.pendingCook) {
      var cookStatus = document.getElementById('cookStatus');
      if (cookStatus) cookStatus.textContent = savedCookText();
    }
  }

  function cookCupSummary(cook) {
    var totals = ZedCook.supplyTotals(cookComponents(cook), state.cookMap);
    return '1.5 oz cups ' + totals.souffleCups + ' and 2 oz lids ' + totals.souffleLids + '. 9 oz cups ' + totals.nineCups + ' and 9 oz lids ' + totals.nineLids + '.';
  }
  function renderCookReview() {
    var panel = document.getElementById('cookPanel');
    if (!panel) return;
    var cook = state.pendingCook || state.cook;
    if (!cook || !cookComponents(cook).length) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }
    var rows = ZedCook.supplyTotals(cookComponents(cook), state.cookMap).rows.filter(function (row) {
      return row.unit !== 'lb' && (row.cupSize || row.itemNumber || /cup$|muffin|chew|omelette|raw /i.test(row.name));
    });
    var allEa = cookComponents(cook).filter(function (row) { return row.unit === 'ea'; });
    var body = allEa.map(function (row) {
      var spec = ZedCook.specFor(row, state.cookMap);
      var size = state.role === 'admin'
        ? '<select data-cook-size="' + esc(row.key) + '" aria-label="Cup size for ' + esc(row.name) + '">' +
          '<option value=""' + (!spec.cupSize ? ' selected' : '') + '>No cup</option>' +
          '<option value="souffle_1_5"' + (spec.cupSize === 'souffle_1_5' ? ' selected' : '') + '>1.5 oz cup + 2 oz lid</option>' +
          '<option value="cup_9oz"' + (spec.cupSize === 'cup_9oz' ? ' selected' : '') + '>9 oz cup + lid</option></select>'
        : esc(spec.cupSize === 'cup_9oz' ? '9 oz cup + lid' : (spec.cupSize === 'souffle_1_5' ? '1.5 oz cup + 2 oz lid' : ''));
      var perField = state.role === 'admin'
        ? '<input data-cook-per="' + esc(row.key) + '" type="number" min="1" step="1" value="' + esc(spec.piecesPerCup) + '" style="width:70px" aria-label="Pieces per cup for ' + esc(row.name) + '">'
        : esc(spec.piecesPerCup);
      var itemField = state.role === 'admin'
        ? '<input data-cook-item="' + esc(row.key) + '" value="' + esc(spec.itemNumber || '') + '" style="width:140px" aria-label="Catalog item for ' + esc(row.name) + '">'
        : esc(spec.itemNumber || '');
      return '<tr><td>' + esc(row.name) + '</td><td>' + esc(row.quantity) + ' ' + esc(row.unit) + '</td><td>' + size + ' ' + perField + ' per cup</td><td>' + itemField + ' ' + esc(spec.catalogName || '') + '</td></tr>';
    }).join('');
    var approve = state.pendingCook && state.role === 'admin'
      ? '<button type="button" id="approveCook">Approve cook list</button> <button type="button" id="discardCook">Discard</button>'
      : '';
    panel.style.display = 'block';
    var savedLine = !state.pendingCook && (cook.fileName || cook.approvedAt)
      ? '<p class="upload-saved">' + esc(ZedBek.savedUploadLine(cook.fileName, '', cook.approvedAt)) + '</p>'
      : '';
    panel.innerHTML = '<h2>Cook list ' + esc(cook.cookDate || '') + '</h2>' + savedLine + '<p>' + cookCupSummary(cook) + '</p>' +
      '<table class="order-table"><thead><tr><th>Component</th><th>Count</th><th>Cup</th><th>Catalog item</th></tr></thead><tbody>' +
      body + '</tbody></table>' + approve;
    var approveBtn = document.getElementById('approveCook');
    var discardBtn = document.getElementById('discardCook');
    if (approveBtn) approveBtn.onclick = approveCook;
    if (discardBtn) discardBtn.onclick = function () { state.pendingCook = null; renderCookReview(); };
  }
  function approveCook() {
    if (!requireAdmin()) return;
    var pending = state.pendingCook;
    if (!pending) {
      setPageStatus('Nothing to approve. Upload the cook list again.', true);
      return;
    }
    if (!pending.cookDate) {
      setPageStatus('That cook list has no cook date, so nothing was saved.', true);
      return;
    }
    pending.fileName = pending.fileName || '';
    pending.approvedAt = new Date().toISOString();
    ZedStorage.setCookList(db, pending.cookDate, pending).then(function () {
      state.cook = {
        cookDate: pending.cookDate,
        components: pending.components,
        fileName: pending.fileName,
        approvedAt: pending.approvedAt,
        sourceText: pending.sourceText || ''
      };
      state.pendingCook = null;
      setPageStatus('Saved cook list for ' + pending.cookDate + '. ' + cookCupSummary(state.cook));
      render();
      markSaved();
    }).catch(showError);
  }
  function onCookFile(file) {
    if (!requireAdmin()) return;
    if (!file) return;
    state.cookBusy = true;
    var status = document.getElementById('cookStatus');
    function setStatus(text) { if (status) status.textContent = text; }
    setStatus('Chosen: ' + file.name + '. Reading the file…');
    var reader = new FileReader();
    reader.onerror = function () {
      state.cookBusy = false;
      setStatus('Chosen: ' + file.name + '. Could not read that file. Try again.');
    };
    reader.onload = function () {
      ZedPlatePdf.parseCookPdf(new Uint8Array(reader.result), function (info) {
        if (info.phase === 'page') setStatus('Chosen: ' + file.name + '. Reading page ' + info.page + ' of ' + info.pages + '…');
      }).then(function (parsed) {
        state.cookBusy = false;
        parsed.fileName = file.name;
        if (!parsed.components || !parsed.components.length) {
          setStatus('Chosen: ' + file.name + '. No component lines were found.');
          return;
        }
        state.pendingCook = parsed;
        setStatus('Chosen: ' + file.name + '. ' + parsed.components.length + ' components. ' + cookCupSummary(parsed));
        renderCookReview();
      }).catch(function (err) {
        state.cookBusy = false;
        setStatus('Chosen: ' + file.name + '. ' + ((err && err.message) || 'Could not parse that PDF.'));
        showError(err);
      });
    };
    reader.readAsArrayBuffer(file);
  }
  function onPlateFile(file) {
    if (!file) return;
    state.plateBusy = true;
    state.plateFileName = file.name;
    var status = document.getElementById('plateStatus');
    function setStatus(text) { if (status) status.textContent = text; }
    setStatus('Chosen: ' + file.name + '. Reading the file…');
    var reader = new FileReader();
    reader.onerror = function () {
      state.plateBusy = false;
      setStatus('Chosen: ' + file.name + '. Could not read that file. Try again.');
    };
    reader.onload = function () {
      setStatus('Chosen: ' + file.name + '. Parsing…');
      ZedPlatePdf.parsePlatePdf(new Uint8Array(reader.result), function (info) {
        if (info.phase === 'page') setStatus('Chosen: ' + file.name + '. Reading page ' + info.page + ' of ' + info.pages + '…');
      }).then(function (parsed) {
        state.plateBusy = false;
        if (!parsed.cookDate || !(Number(parsed.totalCook) >= 0)) {
          setStatus('Chosen: ' + file.name + '. Could not find the cook date and Total Cook.');
          return;
        }
        if (!parsed.dishes || !parsed.dishes.length) {
          state.pendingPlate = null;
          setStatus('Chosen: ' + file.name + '. Total Cook ' + parsed.totalCook + ' was found, but no dish lines. Nothing was saved.');
          setPageStatus('That plate list has a Total Cook but no dish lines, so nothing was saved.', true);
          renderPlateReview();
          return;
        }
        state.pendingPlate = parsed;
        var warn = ZedBek.recipeCycleWarning(parsed.cookDate, state.weekKey);
        var summary = packagingSummary(parsed.dishes, parsed.totalCook);
        if (warn) {
          setStatus('Chosen: ' + file.name + '. Total Cook ' + parsed.totalCook + ' for ' + ZedBek.shortDate(parsed.cookDate) + '. ' + parsed.dishes.length + ' dishes. ' + warn);
          setPageStatus(warn, true);
          renderPlateReview();
          return;
        }
        setStatus('Chosen: ' + file.name + '. Saving ' + parsed.dishes.length + ' dishes. Cups and lids ' + summary.cup + '.');
        saveParsedPlate(parsed);
      }).catch(function (err) {
        state.plateBusy = false;
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
      var ordered = orderFor(row, loc);
      var used = ZedOrder.recipeLineFor(item, state.recipe);
      if (!(need && need.quantity > 0) && !(ordered.amount > 0) && !(used && ZedOrder.isFoodItem(item))) return;
      lines.push('<tr><td class="item-num">' + esc(item.itemNumber || 'no BEK #') + '</td><td>' + esc(item.name) + '</td><td class="need-cell">' +
        needBlock(row, loc) + '</td><td>' + esc(handLabel(row, loc)) + '</td><td class="need-order">' + esc(orderLabel(ordered)) + '</td></tr>');
    });
    var flags = [];
    state.rows.forEach(function (row) {
      var flag = ZedOrder.orderWarning(row.item, casesFor(row, loc), needFor(row, loc), handOf(row, loc));
      if (flag.flagged) flags.push('<li>' + esc(row.item.itemNumber || '') + ' ' + esc(row.item.name) + ' — ' + esc(flag.reasons.join(' ')) + '</li>');
    });
    var warning = flags.length
      ? '<div class="order-warn"><strong>Check these before you submit.</strong><ul>' + flags.join('') + '</ul></div>'
      : '';
    box.innerHTML = warning + '<h2>Order totals</h2><p><button type="button" id="submitOrder">Submit order</button></p>' + (lines.length
      ? '<table class="order-table"><thead><tr><th>Item #</th><th>Name</th><th>Need</th><th>On hand</th><th>Order</th></tr></thead><tbody>' + lines.join('') + '</tbody></table>'
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
    var reviewItems = state.rows.map(function (row) {
      return Object.assign({}, row.item, { label: (row.item && row.item.label) || row.section || '' });
    });
    var ingredientNames = [];
    Object.keys(state.recipe || {}).forEach(function (key) {
      var line = state.recipe[key];
      if (line && line.name && key !== '_meta') ingredientNames.push(line.name);
    });
    var flips = state.role === 'admin' ? ZedOrder.weakFoodReport(reviewItems, ingredientNames) : [];
    var review = flips.length
      ? '<div class="order-warn"><strong>Review these. A short word in the name marked them food.</strong><ul>' +
        flips.map(function (row) {
          return '<li>' + esc(row.itemNumber || 'no BEK #') + ' ' + esc(row.name) + ' — ' + esc(row.reason) + '</li>';
        }).join('') + '</ul></div>'
      : '';
    host.innerHTML = review + groups.map(function (group) {
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
    var ordered = orderFor(row, loc);
    var cases = ordered.unit === 'cs' ? ordered.amount : 0;
    var needText = needBlock(row, loc);
    var temp = item.temporary ? ' <span class="temp-badge">TEMPORARY</span>' : '';
    var food = ZedOrder.isFoodItem(item);
    var countChoices = ['each', 'case', 'lb', 'gal', 'oz', 'jar', 'can', 'carton', 'tub'];
    var countNow = String(ZedOrder.resolvedCountUnit(item) || 'each').toLowerCase();
    if (countNow === 'pound' || countNow === 'pounds') countNow = 'lb';
    if (countNow === 'gallon' || countNow === 'gallons') countNow = 'gal';
    if (countNow === 'ounce' || countNow === 'ounces') countNow = 'oz';
    var countSelect = state.role === 'admin'
      ? '<label>Count <select data-count-unit="' + esc(row.id) + '" aria-label="Count unit for ' + esc(item.name) + '">' +
        countChoices.map(function (choice) {
          return '<option value="' + choice + '"' + (choice === countNow ? ' selected' : '') + '>' + choice + '</option>';
        }).join('') + '</select></label> '
      : '';
    var roleBtn = '';
    if (state.role === 'admin') {
      roleBtn = '<button type="button" data-order-role="' + esc(row.id) + '">' + (food ? 'Food' : 'Supply') + '</button>';
    }
    var countedUnit = ZedOrder.resolvedCountUnit(item);
    var canLb = ZedOrder.canEachLb(item && item.pack);
    var showCanEach = food && ZedOrder.canonUnit(countedUnit) === 'ea' && canLb > 0;
    var showDensity = state.role === 'admin' && food && (ZedOrder.isVolumeUnit(countedUnit) || showCanEach);
    var density = '';
    if (showDensity) {
      var perLabel = showCanEach ? 'each' : ZedOrder.unitLabel(countedUnit);
      var savedPer = Number(item.lbPerUnit) > 0 ? item.lbPerUnit : '';
      var perDefault = showCanEach ? canLb : ZedOrder.defaultLbPer(countedUnit, item);
      var src = ZedOrder.weightSource(item);
      density = '<label>lb per ' + esc(perLabel) + ' <input data-lb-per="' + esc(row.id) + '" type="number" min="0" step="any" inputmode="decimal" placeholder="' + esc(perDefault == null ? '' : Math.round(perDefault * 1000) / 1000) + '" aria-label="Pounds per ' + esc(perLabel) + ' for ' + esc(item.name) + '" value="' + (savedPer === '' ? '' : esc(savedPer)) + '"></label> <span class="weight-source">' + (src ? esc(src.source) : '') + '</span><span class="field-note" data-lb-note="' + esc(row.id) + '"></span>';
    }
    var parCell = '';
    if (!food && state.role === 'admin') {
      var parValue = parOf(row, loc);
      parCell = '<input data-par="' + esc(row.id) + '" type="number" min="0" step="any" inputmode="decimal" aria-label="Standing par for ' + esc(item.name) + '" value="' + (parValue ? esc(parValue) : '') + '"><span class="field-note" data-par-note="' + esc(row.id) + '"></span>';
    }
    var controls = state.role === 'admin'
      ? '<td class="admin-controls"><div class="row-controls' + (showDensity ? ' has-density' : '') + '"><div class="ctrl-par">' + parCell + '</div><div class="ctrl-count">' + countSelect + '</div><div class="ctrl-role">' + roleBtn + '</div><div class="ctrl-density">' + density + '</div></div></td>'
      : '';
    var src = ZedOrder.weightSource(item);
    var weightLine = src ? '<div class="item-brand">' + esc(Math.round(src.lb * 1000) / 1000) + ' lb · ' + esc(src.source) + '</div>' : '';
    var warn = ZedOrder.orderWarning(item, cases, need, hand);
    var warnLine = warn.flagged ? '<div class="order-warn">' + esc(warn.reasons.join(' ')) + '</div>' : '';
    return '<tr' + (warn.flagged ? ' class="order-flag"' : '') + '><td class="item-num">' + esc(item.itemNumber || 'no BEK #') + '</td><td><div class="item-name">' +
      esc(item.name) + temp + '</div><div class="item-brand">' + esc(item.brand || '') + '</div>' + weightLine + '</td><td>' + esc(item.pack || '') +
      '</td><td class="need-cell" data-need-for="' + esc(row.id) + '">' + needText + '</td><td><input class="onhand-input" data-hand="' + esc(row.id) + '" type="number" min="0" step="any" inputmode="decimal" aria-label="On hand ' + esc(item.name) + ' in ' + esc(countNow) + '" value="' +
      (hand == null ? '' : esc(hand)) + '"></td><td class="need-order">' + esc(orderLabel(ordered)) + warnLine + '</td>' +
      controls + '</tr>';
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
      var orderUnit = 'cs';
      var cells = list.map(function (loc) {
        var row = { id: id, item: item, legacyKey: '', source: 'guide' };
        var need = needFor(row, loc);
        var hand = handOf(row, loc);
        var ordered = orderFor(row, loc);
        total += Number(ordered.amount) || 0;
        orderUnit = ordered.unit || orderUnit;
        return '<td class="need-cell">' + needBlock(row, loc) + '</td><td>' + esc(handLabel(row, loc)) + '</td>';
      }).join('');
      return '<tr><td class="item-num">' + esc(item.itemNumber || 'no BEK #') + '</td><td><div class="item-name">' + esc(item.name) +
        (item.temporary ? ' <span class="temp-badge">TEMPORARY</span>' : '') + '</div></td>' + cells +
        '<td class="need-order">' + esc(orderLabel({ amount: total, unit: orderUnit })) + '</td></tr>';
    }).join('');
    document.getElementById('orderTable').innerHTML = '<table class="order-table"><thead><tr><th>Item #</th><th>Name</th>' + head +
      '<th>Order</th></tr></thead><tbody>' + body + '</tbody></table>';
    state.orderRows = ids.map(function (id) { return state.catalog.items[id]; }).filter(Boolean);
  }

  function renderAdmin(loc) {
    var box = document.getElementById('adminTools');
    box.style.display = state.role === 'admin' ? 'block' : 'none';
    if (state.role !== 'admin') return;
    var standardsBox = document.getElementById('standardsPanel');
    if (standardsBox) {
      var labels = ZedOrder.standardLabels();
      var defaults = ZedOrder.defaultStandards();
      standardsBox.innerHTML = '<h2>Standard weights</h2><p>Every matching item uses these. A pounds-per-unit entry on the item replaces the standard. N oz in a name is that many ounces divided by 16. An N / X OZ pack uses X/16 lb per piece.</p>' +
        Object.keys(defaults).map(function (id) {
          var value = state.standards && Number(state.standards[id]) > 0 ? Number(state.standards[id]) : defaults[id];
          return '<label style="display:inline-block;margin:0 12px 8px 0">' + esc(labels[id] || id) +
            ' <input data-standard="' + esc(id) + '" type="number" min="0" step="any" value="' + esc(value) + '" style="width:80px" aria-label="' + esc(labels[id] || id) + '"></label>';
        }).join('');
    }
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
      if (!requireAdmin()) return;
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
      row.catalogId = ZedOrder.forcedRecipeItemId(row) || saved.catalogId || '';
      row.eachFactor = saved.eachFactor == null ? '' : saved.eachFactor;
      row.hideMode = saved.hideMode || '';
      row.matchSaved = true;
      return;
    }
    var suggestion = ZedOrder.filterCatalog(row.name, items, { hidden: state.catalogHidden, solidOnly: true })[0];
    row.catalogId = suggestion ? suggestion.id : '';
    row.eachFactor = '';
    row.hideMode = '';
    row.matchSaved = false;
  }
  function setRecipeStatus(text) {
    var el = document.getElementById('recipeStatus');
    if (el) el.textContent = text;
  }
  function reviewCountText(rows) {
    var saved = 0;
    var suggested = 0;
    var open = 0;
    var hidden = 0;
    (rows || []).forEach(function (row) {
      if (!row) return;
      if (row.hideMode) { hidden += 1; return; }
      if (row.matchSaved && row.catalogId) saved += 1;
      else if (row.catalogId) suggested += 1;
      else open += 1;
    });
    return saved + ' saved, ' + suggested + ' suggested, ' + open + ' unmatched' + (hidden ? ', ' + hidden + ' hidden' : '');
  }
  function updateMatchCount() {
    var purchases = state.pendingRecipe ? state.pendingRecipe.purchases : [];
    var el = document.getElementById('matchCount');
    if (el) el.textContent = reviewCountText(purchases);
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
    panel.innerHTML = '<h2>Review raw purchases before the order is applied</h2><p id="recipeCycleWarning" class="recipe-warn"></p><p>Cook date ' + esc(pending.cookDate || '') +
      '. These are raw weights. Cooked totals and sub-recipe outputs are not ordered twice. A match is saved only when you choose the BEK item on that row. A suggestion is not saved, and Approve does not save suggestions.</p>' +
      '<div class="match-tools"><input id="matchFilter" type="search" placeholder="Find an ingredient" autocomplete="off" enterkeyhint="search"><strong id="matchCount">' +
      reviewCountText(pending.purchases) + '</strong>' +
      '<label><input type="checkbox" id="showHiddenIngredients"' + (state.showHiddenIngredients ? ' checked' : '') + '> Show hidden ingredients</label></div>' +
      '<table class="order-table"><thead><tr><th>Ingredient</th><th>Raw amount</th><th>BEK item</th><th>Each factor</th><th></th></tr></thead><tbody>' +
      pending.purchases.map(function (row, index) {
        var chosen = row.catalogId ? state.catalog.items[row.catalogId] : null;
        var hiddenNote = row.hideMode === 'ignore' ? 'Ignored — not ordered' : (row.hideMode === 'replace' ? 'Replaced — weight carries over' : '');
        var savedLabel = row.matchSaved ? 'Saved' : (row.catalogId ? 'Suggested — not saved' : '');
        var hasWeight = Number(row.pounds) > 0;
        return '<tr class="' + (row.catalogId ? '' : 'unmatched') + (row.hideMode ? ' ingredient-hidden' : '') + '" data-ingredient="' + esc(row.name) + '" data-index="' + index + '"' + (row.hideMode && !state.showHiddenIngredients ? ' hidden' : '') + '><td>' + esc(row.name) +
          '<div class="row-saved" data-saved="' + index + '">' + savedLabel + (hiddenNote && savedLabel ? ' · ' : '') + hiddenNote + '</div></td><td>' + esc(row.pounds) + ' lb</td><td>' +
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
      }).join('') + '</tbody></table><p class="diff-note">Choose No match when nothing fits. Hiding a weighed ingredient asks you to move the weight onto another BEK item, or to leave it off the order.</p><button type="button" id="approveRecipe">Approve recipe needs</button> <button type="button" id="discardRecipe">Discard</button> <button type="button" id="approveAnyway" hidden>Approve for the selected week anyway</button><p id="approveReason" class="recipe-warn"></p><div id="approveConfirm" hidden><p id="approveConfirmText"></p><button type="button" id="approveConfirmYes">Confirm approve</button> <button type="button" id="approveConfirmNo">Cancel</button></div>';
    document.getElementById('approveRecipe').onclick = approveRecipe;
    document.getElementById('approveAnyway').onclick = function () {
      var pending = state.pendingRecipe;
      var fileCook = pending ? ZedOrder.recipeWeek(pending.cookDate) : '';
      var box = document.getElementById('approveConfirm');
      var copy = document.getElementById('approveConfirmText');
      if (copy) copy.textContent = 'Save this file (' + (fileCook ? ZedBek.shortDate(fileCook) : 'no cook date') + ') onto the selected cook date ' + (state.weekKey ? ZedBek.shortDate(state.weekKey) : '') + '?';
      if (box) box.hidden = false;
    };
    document.getElementById('approveConfirmYes').onclick = function () {
      state.allowRecipeMismatch = true;
      approveRecipe();
    };
    document.getElementById('approveConfirmNo').onclick = function () {
      var box = document.getElementById('approveConfirm');
      if (box) box.hidden = true;
    };
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
  function saveMatch(index, options) {
    if (!requireAdmin()) return Promise.resolve();
    var opts = options || {};
    var row = state.pendingRecipe && state.pendingRecipe.purchases[index];
    if (!row) return Promise.resolve();
    // The stored key is the ingredient name. The row index is only how the click finds that name.
    if (!opts.confirm && row.matchSaved !== true) return Promise.resolve();
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

  function approveBlockMessage(text) {
    setPageStatus(text, true);
    var reason = document.getElementById('approveReason');
    if (reason) reason.textContent = text;
  }
  function approveRecipe() {
    if (state.approvingRecipe) {
      approveBlockMessage('Already saving');
      return;
    }
    if (!state.pendingRecipe) {
      approveBlockMessage('Nothing to approve, upload the PDF again');
      return;
    }
    var pending = ZedOrder.claimApproval(state);
    if (!pending) {
      approveBlockMessage(state.approvingRecipe ? 'Already saving' : 'Nothing to approve, upload the PDF again');
      return;
    }
    (pending.purchases || []).forEach(function (row, index) {
      var factorEl = document.querySelector('[data-factor="' + index + '"]');
      if (factorEl) row.eachFactor = factorEl.value === '' ? '' : Number(factorEl.value);
      if (row.matchSaved || row.hideMode === 'ignore' || !row.catalogId) return;
      var suggested = state.catalog.items[row.catalogId];
      if (suggested && (ZedOrder.usesSuggestedRecipe(suggested) || ZedOrder.isGlazeSauceOrCondiment(suggested))) row.includeInOrder = true;
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
    if (mismatch && !state.allowRecipeMismatch) {
      state.approvingRecipe = false;
      state.pendingRecipe = pending;
      setPageStatus(mismatch, true);
      renderRecipeReview();
      return;
    }
    state.allowRecipeMismatch = false;
    var week = state.weekKey;
    var plan = ZedOrder.planRecipeApproval(pending.purchases, week);
    var ingredientCount = Object.keys(plan.lines || {}).length;
    plan.lines._meta = {
      fileName: state.recipeFileName || '',
      approvedAt: new Date().toISOString(),
      ingredientCount: ingredientCount,
      approved: true
    };
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
    state.recipeBusy = true;
    state.recipeFileName = file.name;
    setRecipeStatus('Chosen: ' + file.name + '. Reading the file…');
    var reader = new FileReader();
    reader.onerror = function () {
      state.recipeBusy = false;
      setRecipeStatus('Chosen: ' + file.name + '. Could not read that file. Try again.');
    };
    reader.onload = function () {
      setRecipeStatus('Chosen: ' + file.name + '. Parsing…');
      ZedRecipePdf.parseRecipePdf(new Uint8Array(reader.result), function (info) {
        if (info.phase === 'page') setRecipeStatus('Chosen: ' + file.name + '. Reading page ' + info.page + ' of ' + info.pages + '…');
        else if (info.phase === 'parse') setRecipeStatus('Chosen: ' + file.name + '. Adding up raw ingredients…');
      }).then(function (parsed) {
        state.recipeBusy = false;
        state.pendingRecipe = parsed;
        var panel = document.getElementById('recipePanel');
        if (panel) panel.removeAttribute('data-built');
        setRecipeStatus('Done. ' + file.name + ' — ' + parsed.purchases.length + ' raw ingredients. Review the matches below.');
        renderRecipeReview();
      }).catch(function (err) {
        state.recipeBusy = false;
        setRecipeStatus('Chosen: ' + file.name + '. ' + ((err && err.message) || 'Could not parse that PDF.'));
        showError(err);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  document.getElementById('itemTable').addEventListener('input', function (event) {
    var input = event.target;
    if (!input.dataset || !input.dataset.hand) return;
    state.orderConfirmed = false;
    var id = input.dataset.hand;
    var raw = input.value.trim();
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
    var locNow = currentStore();
    if (row) {
      var needCell = document.querySelector('[data-need-for="' + id + '"]');
      if (needCell) needCell.innerHTML = needBlock(row, locNow);
      if (cell) cell.textContent = orderLabel(orderFor(row, locNow));
      renderSummary(locNow);
    }
    ZedStorage.setOnHand(db, state.locationId, state.weekKey, id, raw === '' ? null : raw).then(function () {
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
    if (input.getAttribute && input.getAttribute('data-count-unit') != null) {
      if (!requireAdmin()) return;
      var unitId = input.getAttribute('data-count-unit');
      var unitItem = state.catalog.items[unitId];
      var unitChoice = input.value;
      if (!unitItem) return;
      ZedStorage.setCountUnit(db, unitId, unitChoice).then(function () {
        unitItem.countUnit = unitChoice;
        unitItem.countUnitChosen = true;
        setPageStatus('Saved. ' + unitItem.name + ' is counted by ' + unitChoice + '.');
        render();
        markSaved();
      }).catch(showError);
      return;
    }
    if (input.getAttribute && input.getAttribute('data-lb-per') != null) {
      if (!requireAdmin()) return;
      var densityId = input.getAttribute('data-lb-per');
      var densityRow = null;
      state.rows.forEach(function (candidate) { if (candidate.id === densityId) densityRow = candidate; });
      var densityItem = densityRow && densityRow.item;
      var densityNote = document.querySelector('[data-lb-note="' + densityId + '"]');
      if (!densityItem) return;
      var densityRaw = String(input.value || '').trim();
      var perUnit = ZedOrder.unitLabel(densityItem.countUnit);
      var densityFields = { lbPerUnit: null };
      if (densityRaw !== '') {
        var densityValue = Number(densityRaw);
        if (!(densityValue > 0)) {
          if (densityNote) densityNote.textContent = 'Enter pounds per ' + perUnit + ', or leave blank for the water default.';
          setPageStatus('Enter pounds per ' + perUnit + ' for ' + densityItem.name + ', or leave it blank.', true);
          return;
        }
        densityFields = { lbPerUnit: densityValue };
      }
      ZedStorage.setItemFields(db, densityId, densityFields).then(function () {
        if (densityFields.lbPerUnit == null) delete densityItem.lbPerUnit;
        else densityItem.lbPerUnit = densityFields.lbPerUnit;
        if (densityNote) densityNote.textContent = 'Saved';
        var tr = input.closest('tr');
        var needCell = tr && tr.querySelector('[data-need-for="' + densityId + '"]');
        var orderCell = tr && tr.querySelector('.need-order');
        var loc = currentStore();
        if (needCell) needCell.innerHTML = needBlock(densityRow, loc);
        if (orderCell) {
          orderCell.textContent = orderLabel(orderFor(densityRow, loc));
        }
        renderSummary(loc);
        setPageStatus(densityFields.lbPerUnit == null
          ? 'Saved. ' + densityItem.name + ' uses ' + (Math.round(ZedOrder.defaultLbPer(ZedOrder.volumeCountUnit(densityItem), densityItem) * 1000) / 1000) + ' lb per ' + perUnit + '.'
          : 'Saved. ' + densityItem.name + ' uses ' + densityFields.lbPerUnit + ' lb per ' + perUnit + '.');
        markSaved();
      }).catch(function (err) {
        if (densityNote) densityNote.textContent = (err && err.message) || 'Could not save that weight.';
        showError(err);
      });
      return;
    }
    if (input.getAttribute && input.getAttribute('data-hand') != null) state.orderConfirmed = false;
    if (!input.getAttribute || input.getAttribute('data-par') == null) return;
    if (!requireAdmin()) return;
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
      if (needCell) needCell.innerHTML = needBlock(row, loc);
      if (orderCell) {
        orderCell.textContent = orderLabel(orderFor(row, loc));
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
    if (!requireAdmin()) return;
    var id = roleBtn.getAttribute('data-order-role');
    var row = null;
    state.rows.forEach(function (candidate) { if (candidate.id === id) row = candidate; });
    var item = row && row.item;
    if (!item) {
      setPageStatus('That row is not on this store, so the food or supply choice cannot be saved.', true);
      return;
    }
    var next = ZedOrder.isFoodItem(item) ? 'supply' : 'food';
    if (!state.catalog.items[id]) state.catalog.items[id] = { id: id };
    ZedStorage.setItemFields(db, id, { orderRole: next }).then(function () {
      state.catalog.items[id].orderRole = next;
      item.orderRole = next;
      setPageStatus('Saved. ' + item.name + ' is ' + (next === 'food' ? 'food from the scaled recipe' : 'a supply with a standing par') + '.');
      render();
    }).catch(showError);
  });
  document.getElementById('storePanel').addEventListener('change', function (event) {
    var box = event.target;
    if (box.dataset && box.dataset.store) {
      if (!requireAdmin()) return;
      var next = ZedLocations.withRole(state.locationDoc, box.dataset.store, box.dataset.role, box.checked);
      var loc = next.locations[box.dataset.store];
      if (box.dataset.role === 'isProductionHub') loc.listSource = box.checked ? 'catalog' : loc.listSource;
      state.locationDoc[loc.id] = loc;
      ZedStorage.setLocation(db, loc).then(function () { fillStores(); reload(); }).catch(showError);
    }
    if (box.dataset && box.dataset.source) {
      if (!requireAdmin()) return;
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
  document.getElementById('adminTools').addEventListener('change', function (event) {
    var standard = event.target && event.target.getAttribute && event.target.getAttribute('data-standard');
    if (standard == null) return;
    if (!requireAdmin()) return;
    var weight = Number(event.target.value);
    ZedStorage.setStandard(db, standard, event.target.value).then(function () {
      if (weight > 0) state.standards[standard] = weight;
      else delete state.standards[standard];
      ZedOrder.useStandards(state.standards);
      setPageStatus('Saved. The standard weight is updated.');
      render();
      markSaved();
    }).catch(showError);
  });
  document.getElementById('showStore').addEventListener('click', function () { showView('store'); });
  document.getElementById('showOrder').addEventListener('click', function () { showView('order'); });
  document.getElementById('recipeFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    onRecipeFile(file);
  });
  var cookFile = document.getElementById('cookFile');
  if (cookFile) cookFile.addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    onCookFile(file);
  });
  document.getElementById('cookPanel').addEventListener('change', function (event) {
    if (!requireAdmin()) return;
    var target = event.target;
    var sizeKey = target.getAttribute && target.getAttribute('data-cook-size');
    var itemKey = target.getAttribute && target.getAttribute('data-cook-item');
    var perKey = target.getAttribute && target.getAttribute('data-cook-per');
    var key = sizeKey || itemKey || perKey;
    if (!key) return;
    var sizeEl = document.querySelector('[data-cook-size="' + key + '"]');
    var itemEl = document.querySelector('[data-cook-item="' + key + '"]');
    var perEl = document.querySelector('[data-cook-per="' + key + '"]');
    var cook = state.pendingCook || state.cook;
    var component = cookComponents(cook).filter(function (row) { return row.key === key; })[0];
    var current = ZedCook.specFor(component || { key: key, name: '' }, state.cookMap);
    var next = {
      itemNumber: itemEl ? itemEl.value.trim() : current.itemNumber,
      catalogName: current.catalogName,
      cupSize: sizeEl ? sizeEl.value : current.cupSize,
      piecesPerCup: perEl && Number(perEl.value) > 0 ? Number(perEl.value) : current.piecesPerCup
    };
    ZedStorage.setCookMap(db, key, next).then(function () {
      state.cookMap[key] = next;
      setPageStatus('Saved cook list mapping for ' + (component ? component.name : key) + '.');
      renderCookReview();
      render();
      markSaved();
    }).catch(showError);
  });
  document.getElementById('plateFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    onPlateFile(file);
  });
  function onPackChoice(select) {
    if (!requireAdmin()) return;
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
    var linkKey = input.getAttribute && (input.getAttribute('data-plate-link-item') || input.getAttribute('data-plate-link-qty'));
    if (linkKey) {
      var itemInput = document.querySelector('[data-plate-link-item="' + linkKey + '"]');
      var qtyInput = document.querySelector('[data-plate-link-qty="' + linkKey + '"]');
      var linkName = (itemInput && itemInput.getAttribute('data-plate-link-name')) || '';
      if (!requireAdmin()) return;
      savePlateItemLink(linkKey, linkName).then(function () {
        setPageStatus('Saved. ' + linkName + ' is on the plate-list order.');
        render();
        markSaved();
      }).catch(showError);
      return;
    }
    if (input.getAttribute && input.getAttribute('data-pieces-per') != null) {
      if (!requireAdmin()) return;
      var component = input.getAttribute('data-pieces-per');
      var perCup = Number(input.value);
      if (!(perCup > 0)) {
        setPageStatus('Enter pieces per cup greater than zero.', true);
        return;
      }
      ZedStorage.setPiecesPerCup(db, component, perCup).then(function () {
        state.piecesPerCup[component] = perCup;
        setPageStatus('Saved. A 9 oz cup holds ' + perCup + ' ' + component + (perCup === 1 ? '' : 's') + '.');
        render();
        markSaved();
      }).catch(showError);
      return;
    }
    if (input.getAttribute && input.getAttribute('data-case-size') != null) {
      if (!requireAdmin()) return;
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
    if (!requireAdmin()) return;
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
      var hideMode = checked ? checked.value : 'replace';
      if (hideMode !== 'ignore' && applyRow.matchSaved !== true) {
        setPageStatus('Confirm the BEK item on this row before replacing. A suggestion is not saved.', true);
        return;
      }
      var plan = ZedOrder.planIngredientHide(applyRow, {
        mode: hideMode,
        catalogId: applyRow.matchSaved ? applyRow.catalogId : ''
      });
      if (!plan.ok) { setPageStatus(plan.error + ' Replace is the default so the weight is not dropped.', true); return; }
      applyRow.hideMode = plan.hideMode;
      applyRow.catalogId = plan.catalogId;
      saveMatch(applyIndex, { confirm: true }).then(function () {
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
      if (!unhide || unhide.matchSaved !== true) return;
      unhide.hideMode = '';
      saveMatch(unhideIndex, { confirm: true }).then(function () {
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
      saveMatch(matchIndex, { confirm: true }).catch(showError);
    }
  });
  document.getElementById('recipePanel').addEventListener('change', function (event) {
    if (!requireAdmin()) return;
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
    if (!requireAdmin()) return;
    var factorRow = state.pendingRecipe && state.pendingRecipe.purchases[factor];
    if (!factorRow) return;
    factorRow.eachFactor = search.value === '' ? '' : Number(search.value);
    if (factorRow.matchSaved !== true) return;
    var factorKey = factorRow.key;
    clearTimeout(search._factorTimer);
    search._factorTimer = setTimeout(function () {
      var current = state.pendingRecipe && state.pendingRecipe.purchases[factor];
      if (!current || current.key !== factorKey || current.matchSaved !== true) return;
      current.eachFactor = search.value === '' ? '' : Number(search.value);
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
          if (!requireAdmin()) return;
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
        return loc.name + ' ' + needLabel(needFor(row, loc)) + ', order ' + orderLabel(orderFor(row, loc));
      });
      lines.push((item.itemNumber || 'no BEK #') + ' ' + item.name + ' | ' + parts.join(' | '));
    });
    return lines;
  }
  function confirmOrder() {
    var flags = [];
    var loc = currentStore();
    state.rows.forEach(function (row) {
      var flag = ZedOrder.orderWarning(row.item, casesFor(row, loc), needFor(row, loc), handOf(row, loc));
      if (flag.flagged) flags.push((row.item.itemNumber || '') + ' ' + row.item.name + ' — ' + flag.reasons.join(' '));
    });
    if (!flags.length || state.orderConfirmed) return true;
    var ok = window.confirm('These orders look high:\n\n' + flags.join('\n') + '\n\nSubmit them anyway?');
    if (ok) state.orderConfirmed = true;
    return ok;
  }
  document.getElementById('orderSummary').addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('#submitOrder');
    if (!button) return;
    if (!confirmOrder()) return;
    rememberPlaced(state.weekKey);
    ZedPdf.downloadPdf('bek-order-' + state.weekKey + '.pdf', ZedPdf.buildPdf({ title: 'Weekly BEK order', lines: bekOrderLines() }));
    setPageStatus('Order submitted. The BEK PDF downloaded.');
  });
  function chicagoClock(now) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    }).format(now || new Date());
  }
  function enteredLabel(who, when) {
    var parts = [];
    if (who) parts.push(String(who));
    if (when != null && when !== '') {
      var date = typeof when === 'number' || /^\d+$/.test(String(when)) ? new Date(Number(when)) : new Date(when);
      if (!isNaN(date.getTime())) parts.push(chicagoClock(date) + ' CT');
      else parts.push(String(when));
    }
    return parts.join(' · ');
  }
  function countRecord(row, loc) {
    loc = loc || currentStore();
    var bag = loc && state.hands ? state.hands[loc.id] : null;
    if ((!bag || bag[row.id] == null || bag[row.id] === '') && loc && loc.id === state.locationId) bag = state.onHand;
    var raw = bag ? bag[row.id] : null;
    if ((raw == null || raw === '') && loc && state.legacyById && state.legacyById[loc.id] && state.legacyById[loc.id][row.id] != null) {
      raw = state.legacyById[loc.id][row.id];
    }
    if ((raw == null || raw === '') && loc && loc.id === state.locationId && row.legacyKey && state.legacyOnHand[row.legacyKey] != null) {
      raw = state.legacyOnHand[row.legacyKey];
    }
    if (raw == null || raw === '') return { amount: '', entered: '' };
    if (typeof raw === 'object') {
      var amount = raw.value == null || raw.value === '' ? '' : ZedBek.formatQty(raw.value);
      return { amount: amount, entered: enteredLabel(raw.by || raw.name || raw.enteredBy || '', raw.at || raw.updatedAt || raw.enteredAt || '') };
    }
    return { amount: ZedBek.formatQty(raw), entered: '' };
  }
  function sheetUnit(item, amount) {
    var word = ZedOrder.countWord(item);
    if (ZedOrder.canonUnit(ZedOrder.resolvedCountUnit(item)) === 'case') word = 'cs';
    return ZedOrder.shortUnit(word, amount);
  }
  function onHandSections(loc) {
    var groups = [];
    var index = {};
    (state.rows || []).forEach(function (row) {
      var title = row.section || 'Items';
      if (row.source === 'special') title = 'Special Order (send direct to BEK rep)';
      if (row.source === 'vendorChecks') title = 'Other vendors';
      if (!Object.prototype.hasOwnProperty.call(index, title)) {
        index[title] = groups.length;
        groups.push({ title: title, rows: [] });
      }
      var item = row.item || {};
      var counted = countRecord(row, loc);
      groups[index[title]].rows.push({
        number: item.itemNumber || '',
        name: item.name || '',
        pack: item.pack || '',
        unit: counted.amount ? sheetUnit(item, counted.amount) : '',
        onHand: counted.amount,
        entered: counted.entered
      });
    });
    return groups;
  }
  function downloadOnHandPdf() {
    var loc = currentStore();
    var cook = state.weekKey || '';
    var place = loc ? loc.name : 'Store';
    var slug = loc && loc.id ? String(loc.id).toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'store';
    ZedPdf.downloadPdf('zedrics-onhand-' + slug + '-' + cook + '.pdf', ZedPdf.buildSheetPdf({
      title: "Zedric's On-Hand Inventory — " + place + " — week of " + cook,
      generated: 'Generated ' + chicagoClock(new Date()) + ' CT',
      sections: onHandSections(loc)
    }));
  }
  document.getElementById('pdfOnHand').addEventListener('click', downloadOnHandPdf);
  document.getElementById('pdfPaper').addEventListener('click', function () {
    var loc = currentStore();
    var lines = ['Store: ' + (loc ? loc.name : ''), 'Item #    Name    Pack    On hand ________    Order ________', ''];
    var last = '';
    (state.rows || []).forEach(function (row) {
      if (row.section !== last) {
        lines.push(row.section || 'Items');
        last = row.section;
      }
      var item = row.item || {};
      var counted = countRecord(row, loc);
      var handText = counted.amount ? counted.amount + ' ' + sheetUnit(item, counted.amount) : '________';
      lines.push((item.itemNumber || '—') + '  ' + (item.name || '') + '  ' + (item.pack || '') + '  On hand ' + handText + '  Order ________');
    });
    ZedPdf.downloadPdf('paper-order-guide-' + (loc ? loc.id : 'store') + '.pdf', ZedPdf.buildPdf({
      title: 'Paper order guide — ' + (loc ? loc.name : ''),
      lines: lines
    }));
  });
  document.getElementById('pdfOrder').addEventListener('click', function () {
    if (!confirmOrder()) return;
    ZedPdf.downloadPdf('bek-order-' + state.weekKey + '.pdf', ZedPdf.buildPdf({ title: 'Weekly BEK order', lines: bekOrderLines() }));
  });
  document.getElementById('pdfSpecial').addEventListener('click', function () {
    var lines = ['Send this list direct to the BEK rep.', ZedBek.formatCycle(state.weekKey), 'Food on this list uses the approved scaled recipe, not the BEK par.', ''];
    state.rows.filter(function (row) { return row.source === 'special'; }).forEach(function (row) {
      var hand = handOf(row);
      var handText = hand == null ? 'not counted' : ZedBek.formatQty(hand) + ' ' + sheetUnit(row.item, hand);
      lines.push((row.item.temporary ? '[TEMPORARY] ' : '') + row.item.name + (row.item.itemNumber ? ' #' + row.item.itemNumber : ' (no BEK #)') +
        ' | ' + needLabel(needFor(row)) + ' | order ' + orderLabel(orderFor(row)) +
        ' | on hand ' + handText);
    });
    ZedPdf.downloadPdf('bek-special-order-' + state.weekKey + '.pdf', ZedPdf.buildPdf({ title: 'Special order — send direct to the BEK rep', lines: lines }));
  });

  function rememberPlaced(week) {
    var list = [];
    try { list = JSON.parse(localStorage.getItem('zedops_orders_placed') || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    if (week && list.indexOf(week) === -1) list.push(week);
    try { localStorage.setItem('zedops_orders_placed', JSON.stringify(list)); } catch (e2) {}
    return list;
  }
  function placedWeeks() {
    try {
      var list = JSON.parse(localStorage.getItem('zedops_orders_placed') || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function chooseWorkingWeek() {
    var today = ZedBek.chicagoParts(new Date()).ymd;
    function datedWeeks(node, skip) {
      var found = [];
      Object.keys(node || {}).forEach(function (key) {
        if (skip && skip[key]) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
        var value = node[key];
        if (!value || typeof value !== 'object' || !Object.keys(value).length) return;
        found.push(key);
      });
      return found;
    }
    return Promise.all([
      db.ref(ZedStorage.PATHS.recipe).once('value'),
      db.ref(ZedStorage.PATHS.plate).once('value'),
      db.ref(ZedStorage.PATHS.cook).once('value'),
      db.ref(ZedStorage.PATHS.counts).once('value')
    ]).then(function (snaps) {
      var weeks = [];
      weeks = weeks.concat(datedWeeks(snaps[0].val()));
      weeks = weeks.concat(datedWeeks(snaps[1].val(), { pack: true, link: true, pieces: true, case: true }));
      weeks = weeks.concat(datedWeeks(snaps[2].val(), { map: true }));
      Object.keys(snaps[3].val() || {}).forEach(function (loc) {
        weeks = weeks.concat(datedWeeks(snaps[3].val()[loc]));
      });
      state.weekKey = ZedBek.workingCookDate(today, { weeks: weeks, placed: placedWeeks() });
    }).catch(function () {
      state.weekKey = ZedBek.openCookDate(today);
    });
  }
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
      return chooseWorkingWeek().then(function () {
        document.getElementById('weekSelect').value = state.weekKey;
        return seedRimPars().then(function () { return reload(); });
      });
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
