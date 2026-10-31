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
    matches: {},
    pendingRecipe: null,
    pendingGuide: null
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
  function showError(err) {
    console.error(err);
    alert((err && err.message) || 'Could not save that change.');
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
  function parOf(row, loc) {
    loc = loc || currentStore();
    var saved = loc && state.allPars && state.allPars[loc.id] ? state.allPars[loc.id][row.id] : state.pars[row.id];
    if (saved && typeof saved === 'object') return Number(saved.value) || 0;
    if (row.legacyKey && state.legacyPars[row.legacyKey]) {
      var old = state.legacyPars[row.legacyKey];
      return typeof old === 'object' ? (Number(old.value) || 0) : (Number(old) || 0);
    }
    return row.item.guidePar != null ? Number(row.item.guidePar) || 0 : 0;
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
  function needFor(row, loc) {
    var food = ZedOrder.isFoodItem(row.item);
    var recipe = recipeNeed(row.item);
    if (ZedLocations.listSourceOf(loc) === 'catalog' && food && recipe) return recipe;
    var par = parOf(row);
    if (!(par > 0)) return null;
    return { quantity: par, unit: row.item.countUnit || 'each', eachFactor: null, par: true };
  }
  function casesFor(row, loc) {
    var need = needFor(row, loc);
    if (!need) return 0;
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
      db.ref(ZedStorage.PATHS.ingredientMap).once('value')
    ];
    if (ZedLocations.listSourceOf(loc) === 'inventory') {
      jobs.push(db.ref('staging_weekly_orders/' + loc.id + '/' + week).once('value'));
      jobs.push(db.ref('staging_weekly_orders/' + loc.id + '/pars').once('value'));
    }
    return Promise.all(jobs).then(function (snaps) {
      state.onHand = snaps[0].val() || {};
      state.pars = snaps[1].val() || {};
      state.recipe = snaps[2].val() || {};
      state.matches = snaps[3].val() || {};
      state.legacyOnHand = snaps[4] ? (snaps[4].val() || {}) : {};
      state.legacyPars = snaps[5] ? (snaps[5].val() || {}) : {};
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
    var chain = Promise.resolve();
    stores().forEach(function (loc) {
      chain = chain.then(function () {
        return db.ref(ZedStorage.PATHS.counts + '/' + loc.id + '/' + state.weekKey).once('value').then(function (snap) {
          state.hands[loc.id] = snap.val() || {};
        });
      }).then(function () {
        return db.ref(ZedStorage.PATHS.pars + '/' + loc.id).once('value').then(function (snap) {
          state.allPars[loc.id] = snap.val() || {};
        });
      });
      if (ZedLocations.listSourceOf(loc) !== 'inventory') return;
      chain = chain.then(function () {
        return db.ref('staging_weekly_orders/' + loc.id + '/' + state.weekKey).once('value').then(function (snap) {
          var counts = snap.val() || {};
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
    });
    return chain;
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
    document.getElementById('storeView').style.display = state.view === 'store' ? 'block' : 'none';
    document.getElementById('orderView').style.display = state.view === 'order' ? 'block' : 'none';
    var badge = document.getElementById('locationBadge');
    if (badge && loc) {
      var kind = ZedLocations.listSourceOf(loc) === 'catalog' ? 'Full BEK catalog' : 'Store supplies';
      badge.textContent = loc.name + ' · ' + kind + (ZedLocations.roleLabel(loc) ? ' · ' + ZedLocations.roleLabel(loc) : '');
    }
    document.getElementById('dueLine').textContent = 'Counts are due by the end of Tuesday ' + state.weekKey + '. Order cases round up, so the order is never short.';
    if (state.view === 'order') renderOrder();
    else renderStore(loc);
    renderAdmin(loc);
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
    var needText = need ? (ZedBek.formatQty(need.quantity) + ' ' + (need.unit || '')) : '—';
    if (need && need.par) needText = 'par ' + needText;
    var temp = item.temporary ? ' <span class="temp-badge">TEMPORARY</span>' : '';
    var parBtn = state.role === 'admin' && !ZedOrder.isFoodItem(item)
      ? '<button type="button" class="edit-par-btn" data-par="' + esc(row.id) + '">' + (parOf(row) || 'set') + '</button>' : '';
    return '<tr><td class="item-num">' + esc(item.itemNumber || 'no BEK #') + '</td><td><div class="item-name">' +
      esc(item.name) + temp + '</div><div class="item-brand">' + esc(item.brand || '') + '</div></td><td>' + esc(item.pack || '') +
      '</td><td>' + esc(needText) + '</td><td><input class="onhand-input" data-hand="' + esc(row.id) + '" type="number" min="0" step="any" value="' +
      (hand == null ? '' : esc(hand)) + '"></td><td class="need-order">' + (cases > 0 ? cases + ' cs' : '—') + '</td>' +
      (state.role === 'admin' ? '<td>' + parBtn + '</td>' : '') + '</tr>';
  }

  function renderOrder() {
    var list = stores();
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
        var needText = need ? ZedBek.formatQty(need.quantity) + ' ' + need.unit : '—';
        return '<td>' + esc(needText) + '</td><td>' + (hand == null ? '—' : esc(hand)) + '</td>';
      }).join('');
      return '<tr><td class="item-num">' + esc(item.itemNumber || 'no BEK #') + '</td><td><div class="item-name">' + esc(item.name) +
        (item.temporary ? ' <span class="temp-badge">TEMPORARY</span>' : '') + '</div></td>' + cells +
        '<td class="need-order">' + (total > 0 ? total + ' cs' : '—') + '</td></tr>';
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

  function renderRecipeReview() {
    var panel = document.getElementById('recipePanel');
    var pending = state.pendingRecipe;
    if (!pending) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }
    panel.style.display = 'block';
    var items = Object.keys(state.catalog.items).map(function (id) { return state.catalog.items[id]; });
    panel.innerHTML = '<h2>Review raw purchases before anything is saved</h2><p>Cook date ' + esc(pending.cookDate || '') +
      '. These are raw weights. Cooked totals and sub-recipe outputs are not ordered twice. Nothing is saved until you approve.</p><table class="order-table"><thead><tr><th>Ingredient</th><th>Raw amount</th><th>Match</th><th>Each factor</th></tr></thead><tbody>' +
      pending.purchases.map(function (row, index) {
        var saved = state.matches[row.key] || {};
        var suggestions = ZedOrder.suggestMatches(row.name, items, 3);
        var chosen = saved.catalogId || (suggestions[0] && suggestions[0].id) || '';
        var options = '<option value="">Unmatched</option>' + items.filter(function (item) { return item.itemNumber || item.internalKey; }).slice(0, 400).map(function (item) {
          return '<option value="' + esc(item.id) + '"' + (item.id === chosen ? ' selected' : '') + '>' + esc((item.itemNumber || 'no #') + ' ' + item.name) + '</option>';
        }).join('');
        var factor = saved.eachFactor || '';
        return '<tr class="' + (chosen ? '' : 'unmatched') + '"><td>' + esc(row.name) + '</td><td>' + esc(row.pounds) + ' lb</td><td><select data-match="' + index + '">' + options + '</select></td><td><input data-factor="' + index + '" type="number" min="0" step="any" placeholder="lb per each" value="' + esc(factor) + '" style="width:110px"></td></tr>';
      }).join('') + '</tbody></table><p class="diff-note">Unmatched rows stay visible and are not ordered.</p><button type="button" id="approveRecipe">Approve recipe needs</button> <button type="button" id="discardRecipe">Discard</button>';
    document.getElementById('approveRecipe').onclick = approveRecipe;
    document.getElementById('discardRecipe').onclick = function () { state.pendingRecipe = null; renderRecipeReview(); };
  }

  function approveRecipe() {
    var pending = state.pendingRecipe;
    if (!pending) return;
    var week = ZedBek.addDays(pending.cookDate, -((new Date(pending.cookDate + 'T12:00:00Z').getUTCDay() - 2 + 7) % 7));
    state.weekKey = week;
    document.getElementById('weekSelect').value = week;
    var chain = Promise.resolve();
    pending.purchases.forEach(function (row, index) {
      var select = document.querySelector('[data-match="' + index + '"]');
      var factor = document.querySelector('[data-factor="' + index + '"]');
      var catalogId = select ? select.value : '';
      var eachFactor = factor && factor.value !== '' ? Number(factor.value) : null;
      chain = chain.then(function () {
        return ZedStorage.setIngredientMatch(db, row.key, { name: row.name, catalogId: catalogId, eachFactor: eachFactor });
      }).then(function () {
        if (!catalogId) return null;
        return ZedStorage.setRecipeLine(db, week, row.key, {
          name: row.name, pounds: row.pounds, unit: 'lb', catalogId: catalogId, eachFactor: eachFactor
        });
      });
    });
    chain.then(function () {
      state.pendingRecipe = null;
      return reload();
    }).then(function () { markSaved(); alert('Recipe needs saved for the week of ' + week + '.'); }).catch(showError);
  }

  function onRecipeFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      ZedRecipePdf.parseRecipePdf(new Uint8Array(reader.result)).then(function (parsed) {
        state.pendingRecipe = parsed;
        renderRecipeReview();
      }).catch(showError);
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
      if (cell && row) cell.textContent = (casesFor(row, currentStore()) > 0 ? casesFor(row, currentStore()) + ' cs' : '—');
      markSaved();
    }).catch(showError);
  });
  document.getElementById('itemTable').addEventListener('click', function (event) {
    var button = event.target.closest('[data-par]');
    if (!button) return;
    var row = null;
    state.rows.forEach(function (candidate) { if (candidate.id === button.dataset.par) row = candidate; });
    if (!row) return;
    var next = prompt('Standing par for ' + row.item.name + ' in ' + (row.item.countUnit || 'units'), String(parOf(row) || ''));
    if (next == null) return;
    var value = Number(next);
    if (!isFinite(value) || value < 0) return;
    ZedStorage.setPar(db, state.locationId, row.id, { value: value, unit: row.item.countUnit || '' }).then(function () {
      state.pars[row.id] = { value: value, unit: row.item.countUnit || '' };
      render();
      markSaved();
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
    state.weekKey = this.value || ZedBek.countWeekTuesday(new Date());
    reload();
  });
  document.getElementById('showStore').addEventListener('click', function () { state.view = 'store'; history.replaceState(null, '', 'weekly-order.html'); render(); });
  document.getElementById('showOrder').addEventListener('click', function () { state.view = 'order'; history.replaceState(null, '', 'weekly-order.html#order'); render(); });
  document.getElementById('recipeFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    onRecipeFile(file);
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
  document.getElementById('pdfOrder').addEventListener('click', function () {
    var lines = ['Week of Tuesday ' + state.weekKey, 'Cases are rounded up.', ''];
    document.querySelectorAll('#orderTable tbody tr').forEach(function (tr) { lines.push(tr.innerText.replace(/\s+/g, ' ').trim()); });
    ZedPdf.downloadPdf('bek-order-' + state.weekKey + '.pdf', ZedPdf.buildPdf({ title: 'Weekly BEK order', lines: lines }));
  });
  document.getElementById('pdfSpecial').addEventListener('click', function () {
    var lines = ['Send this list direct to the BEK rep.', 'Week of Tuesday ' + state.weekKey, ''];
    state.rows.filter(function (row) { return row.source === 'special'; }).forEach(function (row) {
      var hand = handOf(row);
      lines.push((row.item.temporary ? '[TEMPORARY] ' : '') + row.item.name + (row.item.itemNumber ? ' #' + row.item.itemNumber : ' (no BEK #)') +
        ' | on hand ' + (hand == null ? 'not counted' : hand + ' ' + (row.item.countUnit || '')));
    });
    ZedPdf.downloadPdf('bek-special-order-' + state.weekKey + '.pdf', ZedPdf.buildPdf({ title: 'Special order — send direct to the BEK rep', lines: lines }));
  });

  function showApp(role) {
    state.role = role || 'team';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
    document.getElementById('roleBadge').textContent = state.role === 'admin' ? 'Admin' : 'Team';
    state.weekKey = ZedBek.countWeekTuesday(new Date());
    document.getElementById('weekSelect').value = state.weekKey;
    ZedBek.loadSeed().then(function (seed) { return ZedBek.prepareDatabase(db, seed); }).then(function () {
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
