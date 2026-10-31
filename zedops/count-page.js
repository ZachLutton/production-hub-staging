// Weekly BEK count screen. Stores, the catalog, and saves come from the shared ZedOps modules.
(function () {
  var boot = ZedBoot.start({ storageKey: 'zedops_staging_bek_local_v1' });
  if (boot.mode === 'blocked') {
    throw new Error('Refusing to start. firebase-config.js points at the live Production Hub.');
  }
  var db = boot.db;
  var renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () { render(); renderDiff(); }, 40);
  }

  var state = {
    role: 'team',
    locationId: '',
    weekKey: '',
    catalog: ZedCatalog.emptyCatalog(),
    locationDoc: {},
    onHand: {},
    pars: {},
    hidden: {},
    showHidden: false,
    filter: 'all',
    pending: null,
    stops: []
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function money(value) {
    var number = Number(value);
    if (!isFinite(number)) return '';
    return '$' + number.toFixed(2);
  }

  function countingStores() {
    return ZedLocations.listLocations(state.locationDoc).filter(function (loc) { return loc.countsWeeklyBek; });
  }

  function currentStore() {
    var list = countingStores();
    for (var i = 0; i < list.length; i++) if (list[i].id === state.locationId) return list[i];
    return null;
  }

  function markSaved() {
    var now = new Date();
    var stamp = [now.getHours(), now.getMinutes(), now.getSeconds()].map(function (n) {
      return String(n).padStart(2, '0');
    }).join(':');
    var el = document.getElementById('lastSaved');
    if (el) { el.textContent = 'Saved at ' + stamp; el.style.color = '#4CAF50'; }
  }

  function showError(err) {
    console.error(err);
    alert((err && err.message) || 'Could not save that change.');
  }

  function setSync(on) {
    var el = document.getElementById('syncStatus');
    if (!el) return;
    if (window.ZEDOPS_STAGING && window.ZEDOPS_STAGING.mode === 'local') {
      el.innerHTML = '<span style="color:#F9A825;">●</span> This browser only';
      return;
    }
    el.innerHTML = on ? '<span style="color:#4CAF50;">●</span> Live sync on' : '<span style="color:#ff6b6b;">●</span> Connecting...';
  }

  function stopListeners() {
    state.stops.forEach(function (stop) { stop(); });
    state.stops = [];
  }

  function listenChildren(path, onValue) {
    var ref = db.ref(path);
    var handle = function (snap) { onValue(snap.key, snap.val()); };
    var remove = function (snap) { onValue(snap.key, null); };
    ref.on('child_added', handle);
    ref.on('child_changed', handle);
    ref.on('child_removed', remove);
    state.stops.push(function () { ref.off(); });
  }

  function paintNeed(id) {
    var item = state.catalog.items[id];
    if (!item) return;
    var par = ZedBek.parOf(item, state.pars);
    var raw = state.onHand[id];
    var have = raw == null || raw === '' ? 0 : Number(raw);
    var short = ZedBek.need(par.value, have);
    var el = document.getElementById('need-' + id);
    if (!el) return;
    el.textContent = short > 0 ? ZedBek.formatQty(short) : '—';
    el.className = 'need-value ' + (short > 0 ? 'need-order' : 'need-zero');
  }

  function paintGrand() {
    var total = 0;
    document.querySelectorAll('.need-value').forEach(function (el) {
      var n = parseFloat(el.textContent);
      if (!isNaN(n)) total += n;
    });
    var grand = document.getElementById('totalNeeded');
    if (grand) grand.textContent = ZedBek.formatQty(total) || '0';
  }

  function rowHidden(item) {
    return !!(state.hidden && state.hidden[item.id] === true);
  }

  function passesFilter(item) {
    if (rowHidden(item) && !state.showHidden) return false;
    var par = ZedBek.parOf(item, state.pars).value;
    var raw = state.onHand[item.id];
    var have = raw == null || raw === '' ? 0 : Number(raw);
    if (state.filter === 'needed' && !(ZedBek.need(par, have) > 0)) return false;
    if (state.filter === 'hasPar' && !(par > 0)) return false;
    return true;
  }

  function itemRow(item) {
    var par = ZedBek.parOf(item, state.pars);
    var have = Object.prototype.hasOwnProperty.call(state.onHand, item.id) && state.onHand[item.id] != null ? state.onHand[item.id] : '';
    var short = ZedBek.need(par.value, have === '' ? 0 : have);
    var admin = state.role === 'admin';
    var hidden = rowHidden(item);
    var number = item.itemNumber || (item.internalKey ? 'no BEK #' : '');
    var flags = item.temporary ? ' <span class="temp-badge">TEMPORARY</span>' : '';
    var remove = item.temporary && admin ? ' <button type="button" class="remove-temp" data-remove="' + esc(item.id) + '">Remove</button>' : '';
    var unitBtn = admin ? ' <button type="button" class="edit-par-btn" data-unit="' + esc(item.id) + '">edit</button>' : '';
    var parBtn = admin ? ' <button type="button" class="edit-par-btn" data-par="' + esc(item.id) + '">edit</button>' : '';
    var hideBtn = '';
    if (admin) {
      hideBtn = hidden
        ? '<button type="button" class="restore-item-btn" data-restore="' + esc(item.id) + '">↩</button>'
        : '<button type="button" class="delete-item-btn" data-hide="' + esc(item.id) + '">X</button>';
    }
    return '<tr class="' + (hidden ? 'hidden-row' : '') + '" data-id="' + esc(item.id) + '">' +
      '<td class="item-num">' + esc(number) + '</td>' +
      '<td><div class="item-name">' + esc(item.name) + flags + remove + '</div>' +
      (item.brand ? '<div class="item-brand">' + esc(item.brand) + '</div>' : '') + '</td>' +
      '<td>' + esc(item.pack || '') + '</td>' +
      '<td>' + esc(item.countUnit || '') + unitBtn + '</td>' +
      '<td class="par-cell"><span class="par-value">' + (par.value ? esc(ZedBek.formatQty(par.value)) : '—') + '</span>' + parBtn + '</td>' +
      '<td class="onhand-cell"><input class="onhand-input" data-hand="' + esc(item.id) + '" type="number" min="0" step="any" value="' + esc(have) + '"></td>' +
      '<td class="need-cell"><span class="need-value ' + (short > 0 ? 'need-order' : 'need-zero') + '" id="need-' + esc(item.id) + '">' +
      (short > 0 ? esc(ZedBek.formatQty(short)) : '—') + '</span></td>' +
      (admin ? '<td>' + hideBtn + '</td>' : '') +
      '</tr>';
  }

  function sectionHtml(title, meta, rows) {
    var visible = rows.filter(passesFilter);
    if (!visible.length) return '';
    return '<div class="section"><div class="section-header"><div><div class="section-header-title">' + esc(title) +
      '</div><div class="section-header-meta">' + esc(meta || (visible.length + ' items')) + '</div></div></div>' +
      '<div class="section-content expanded"><table class="order-table"><thead><tr>' +
      '<th>Item #</th><th>Name</th><th>Pack</th><th>Count unit</th><th>Par</th><th>On hand</th><th>Need</th>' +
      (state.role === 'admin' ? '<th></th>' : '') + '</tr></thead><tbody>' +
      visible.map(itemRow).join('') + '</tbody></table></div></div>';
  }

  function render() {
    var host = document.getElementById('order-container');
    if (!host || !state.catalog) return;
    var html = '';
    ZedBek.groupsForGuide(state.catalog).forEach(function (group) {
      html += sectionHtml(group.label, '', group.items);
    });
    html += sectionHtml('Special Order (send direct to BEK rep)', 'These are not on the shelf guide. The temporary row can be removed.', ZedBek.orderedItems(state.catalog, 'special'));
    html += sectionHtml('Other vendors', 'End of the list. These are checks, not BEK items.', ZedBek.orderedItems(state.catalog, 'vendorChecks'));
    host.innerHTML = html || '<div class="empty-state">No items match this view.</div>';
    paintGrand();
    var store = currentStore();
    var badge = document.getElementById('locationBadge');
    if (badge) {
      var role = store ? ZedLocations.roleLabel(store) : '';
      badge.textContent = store ? (store.name + (role ? ' · ' + role : '')) : 'No store selected';
    }
    var due = document.getElementById('dueLine');
    if (due) due.textContent = 'Counts are due by the end of Tuesday ' + state.weekKey + '. On hand can be a partial, such as 0.5 gallon.';
    renderStores();
    renderPriceGate();
  }

  function renderDiff() {
    var panel = document.getElementById('diffPanel');
    if (!panel) return;
    var pending = state.pending;
    if (!pending) { panel.style.display = 'none'; panel.innerHTML = ''; return; }
    var diff = pending.diff;
    panel.style.display = 'block';
    function lines(title, rows, format) {
      if (!rows || !rows.length) return '';
      return '<h3>' + esc(title) + ' (' + rows.length + ')</h3><ul>' + rows.map(function (row) {
        return '<li>' + format(row) + '</li>';
      }).join('') + '</ul>';
    }
    var body = lines('Moved', diff.moved, function (row) {
      return esc(row.name) + ' #' + esc(row.itemNumber) + ' from ' + esc(row.fromLabel) + ' to ' + esc(row.toLabel);
    }) + lines('Added', diff.added, function (row) {
      return esc(row.name) + (row.itemNumber ? ' #' + esc(row.itemNumber) : '');
    }) + lines('Dropped', diff.dropped, function (row) {
      return esc(row.name) + (row.itemNumber ? ' #' + esc(row.itemNumber) : '') + ' (saved counts stay on the item number)';
    }) + lines('Substitutions', diff.substitutions, function (row) {
      var from = row.from || {};
      var to = row.to || {};
      return esc(from.name || from.itemNumber || '') + ' → ' + esc(to.name || '') + (row.note ? ' (' + esc(row.note) + ')' : '');
    }) + lines('Price increases', diff.priceUp, function (row) {
      return esc(row.name) + ' #' + esc(row.itemNumber) + ' ' + money(row.from) + ' → ' + money(row.to);
    }) + lines('Price decreases', diff.priceDown, function (row) {
      return esc(row.name) + ' #' + esc(row.itemNumber) + ' ' + money(row.from) + ' → ' + money(row.to);
    });
    if (diff.empty) body = '<p>No differences. Nothing will be changed.</p>';
    panel.innerHTML = '<h2>Review the guide before anything changes</h2>' + body +
      '<p class="diff-note">Counts, pars, and count units stay where they are. This applies only if you approve.</p>' +
      '<button type="button" id="approveDiff" ' + (diff.empty ? 'disabled' : '') + '>Approve and apply</button> ' +
      '<button type="button" id="discardDiff">Discard</button>';
    var approve = document.getElementById('approveDiff');
    var discard = document.getElementById('discardDiff');
    if (approve) approve.onclick = applyPending;
    if (discard) discard.onclick = discardPending;
  }

  function renderPriceGate() {
    var panel = document.getElementById('pricePanel');
    if (!panel) return;
    var last = ZedBek.isLastMonday(new Date());
    if (!last) {
      panel.innerHTML = '<p>BEK prices are copied into the month-end count only on the last Monday of the month, and only after you approve. Nothing is copied on its own.</p>';
      return;
    }
    if (state.role !== 'admin') {
      panel.innerHTML = '<p>Today is the last Monday. An admin can approve BEK prices for this month\'s count. Nothing is copied until then.</p>';
      return;
    }
    var changes = state.pricePreview || { up: [], down: [] };
    var bits = [];
    changes.up.forEach(function (row) { bits.push('<li>Up: ' + esc(row.item.name) + ' #' + esc(row.item.itemNumber) + ' ' + money(row.from) + ' → ' + money(row.to) + '</li>'); });
    changes.down.forEach(function (row) { bits.push('<li>Down: ' + esc(row.item.name) + ' #' + esc(row.item.itemNumber) + ' ' + money(row.from) + ' → ' + money(row.to) + '</li>'); });
    panel.innerHTML = '<h2>Last Monday — month-end prices</h2><p>Approving stores these BEK prices for this month\'s count. The monthly page uses them for this month only. Other months stay as they are.</p>' +
      (bits.length ? '<ul>' + bits.join('') + '</ul>' : '<p>No price difference against the month-end list.</p>') +
      '<button type="button" id="approvePrices">Approve prices for the month-end count</button>';
    var button = document.getElementById('approvePrices');
    if (button) button.onclick = approvePrices;
  }

  function renderStores() {
    var panel = document.getElementById('storePanel');
    if (!panel) return;
    if (state.role !== 'admin') { panel.innerHTML = ''; return; }
    var rows = ZedLocations.listLocations(state.locationDoc).map(function (loc) {
      function box(role, label) {
        return '<label><input type="checkbox" data-store="' + esc(loc.id) + '" data-role="' + role + '"' +
          (loc[role] ? ' checked' : '') + '> ' + label + '</label>';
      }
      return '<div class="store-row"><strong>' + esc(loc.name) + '</strong> ' +
        box('isCulinaryCenter', 'Culinary center') + ' ' +
        box('isProductionHub', 'Production hub') + ' ' +
        box('countsWeeklyBek', 'Counts this list') + '</div>';
    }).join('');
    panel.innerHTML = '<h2>Stores</h2><p>Any store can be the culinary center or the production hub. Add a store when you open a new one.</p>' +
      rows + '<button type="button" id="addStore">Add a store</button>';
    var add = document.getElementById('addStore');
    if (add) add.onclick = function () {
      var name = prompt('Store name');
      if (!name) return;
      var result = ZedLocations.addLocation(state.locationDoc, { name: name, countsWeeklyBek: true });
      ZedStorage.setLocation(db, result.added).then(function () {
        state.locationDoc[result.added.id] = result.added;
        fillLocations();
        render();
        markSaved();
      }).catch(showError);
    };
  }

  function fillLocations() {
    var select = document.getElementById('locationSelect');
    if (!select) return;
    var list = countingStores();
    var previous = state.locationId;
    select.innerHTML = list.map(function (loc) {
      return '<option value="' + esc(loc.id) + '">' + esc(loc.name) + '</option>';
    }).join('');
    if (!list.length) {
      select.innerHTML = '<option value="">No store counts this list yet</option>';
      state.locationId = '';
      return;
    }
    var saved = previous;
    try { saved = saved || localStorage.getItem('zedops_bek_location') || ''; } catch (e) {}
    var pick = list.filter(function (loc) { return loc.id === saved; })[0];
    if (!pick) pick = list.filter(function (loc) { return loc.isProductionHub; })[0] || list[0];
    state.locationId = pick.id;
    select.value = pick.id;
  }

  function catalogFromSnap(val) {
    var raw = val || {};
    return ZedSchema.migrateCatalog({
      schemaVersion: raw.schemaVersion || 1,
      items: raw.items || {},
      shelf: raw.shelf || {}
    });
  }

  function reloadLists() {
    return Promise.all([
      db.ref(ZedStorage.PATHS.catalog).once('value'),
      db.ref(ZedStorage.PATHS.locations).once('value'),
      db.ref(ZedStorage.PATHS.drafts + '/guide').once('value')
    ]).then(function (snaps) {
      state.catalog = catalogFromSnap(snaps[0].val());
      state.locationDoc = snaps[1].val() || {};
      fillLocations();
      var draft = snaps[2].val();
      state.pending = null;
      if (draft && draft.rows && state.role === 'admin') {
        try {
          state.pending = { diff: ZedBek.diffUpload(state.catalog, draft), draft: true };
        } catch (e) { state.pending = null; }
      }
      return reloadWeek();
    });
  }

  function reloadWeek() {
    if (!state.locationId || !state.weekKey) return Promise.resolve();
    return Promise.all([
      db.ref(ZedStorage.PATHS.counts + '/' + state.locationId + '/' + state.weekKey).once('value'),
      db.ref(ZedStorage.PATHS.pars + '/' + state.locationId).once('value'),
      db.ref(ZedStorage.PATHS.hidden + '/' + state.locationId).once('value')
    ]).then(function (snaps) {
      state.onHand = snaps[0].val() || {};
      state.pars = snaps[1].val() || {};
      state.hidden = snaps[2].val() || {};
      return loadPricePreview();
    });
  }

  function loadPricePreview() {
    if (!ZedBek.isLastMonday(new Date()) || state.role !== 'admin') {
      state.pricePreview = { up: [], down: [] };
      return Promise.resolve();
    }
    var ids = {};
    ZedLocations.listLocations(state.locationDoc).forEach(function (loc) {
      if (loc.monthlyLocationId) ids[loc.monthlyLocationId] = true;
    });
    var chain = Promise.resolve([]);
    Object.keys(ids).forEach(function (id) {
      chain = chain.then(function (rows) {
        return db.ref('staging_inventory/' + id + '/items').once('value').then(function (snap) {
          return rows.concat(ZedBek.flattenInventory(snap.val() || {}));
        }).catch(function () { return rows; });
      });
    });
    return chain.then(function (rows) {
      state.pricePreview = ZedBek.priceChanges(state.catalog, rows);
    });
  }

  function attach() {
    stopListeners();
    listenChildren(ZedStorage.PATHS.catalog + '/items', function (id, value) {
      if (!value) delete state.catalog.items[id];
      else state.catalog.items[id] = value;
      if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.hand) return;
      scheduleRender();
    });
    var shelfRef = db.ref(ZedStorage.PATHS.catalog + '/shelf');
    var onShelf = function (snap) {
      state.catalog.shelf = snap.val() || { guide: [], special: [], vendorChecks: [] };
      scheduleRender();
    };
    shelfRef.on('value', onShelf);
    state.stops.push(function () { shelfRef.off(); });
    listenChildren(ZedStorage.PATHS.locations, function (id, value) {
      if (!value) delete state.locationDoc[id];
      else state.locationDoc[id] = value;
      fillLocations();
      scheduleRender();
    });
    attachWeek();
    db.ref('.info/connected').on('value', function (snap) { setSync(snap.val() === true); });
  }

  function attachWeek() {
    if (!state.locationId || !state.weekKey) return;
    listenChildren(ZedStorage.PATHS.counts + '/' + state.locationId + '/' + state.weekKey, function (id, value) {
      if (value == null) delete state.onHand[id];
      else state.onHand[id] = value;
      var input = document.querySelector('input[data-hand="' + id + '"]');
      if (input && document.activeElement !== input) input.value = value == null ? '' : value;
      paintNeed(id);
      paintGrand();
    });
    listenChildren(ZedStorage.PATHS.pars + '/' + state.locationId, function (id, value) {
      if (value == null) delete state.pars[id];
      else       state.pars[id] = value;
      scheduleRender();
    });
    listenChildren(ZedStorage.PATHS.hidden + '/' + state.locationId, function (id, value) {
      if (value == null) delete state.hidden[id];
      else state.hidden[id] = value;
      scheduleRender();
    });
  }

  function sheetRows(items) {
    return items.filter(function (item) { return ZedBek.isShown(item) && passesFilter(item); }).map(function (item) {
      var par = ZedBek.parOf(item, state.pars);
      var have = state.onHand[item.id];
      var counted = have != null && have !== '';
      return item.name + (item.temporary ? ' [TEMPORARY]' : '') +
        (item.itemNumber ? ' #' + item.itemNumber : ' (no BEK #)') +
        ' pack ' + (item.pack || '—') +
        ' | on hand ' + (counted ? ZedBek.formatQty(have) + ' ' + (item.countUnit || '') : 'not counted') +
        ' | par ' + (par.value ? ZedBek.formatQty(par.value) + ' ' + (item.countUnit || '') : '—') +
        ' | need ' + (counted || par.value ? ZedBek.formatQty(ZedBek.need(par.value, counted ? have : 0)) : '—');
    });
  }

  function downloadCount() {
    var store = currentStore();
    var lines = ['Store: ' + (store ? store.name : ''), 'Week of Tuesday ' + state.weekKey, 'Due end of day Tuesday.', ''];
    ZedBek.groupsForGuide(state.catalog).forEach(function (group) {
      lines.push(group.label);
      sheetRows(group.items).forEach(function (line) { lines.push(line); });
      lines.push('');
    });
    lines.push('Special Order (send direct to BEK rep)');
    sheetRows(ZedBek.orderedItems(state.catalog, 'special')).forEach(function (line) { lines.push(line); });
    lines.push('');
    lines.push('Other vendors');
    sheetRows(ZedBek.orderedItems(state.catalog, 'vendorChecks')).forEach(function (line) { lines.push(line); });
    ZedPdf.downloadPdf('bek-count-' + state.weekKey + '.pdf', ZedPdf.buildPdf({
      title: 'Weekly BEK count — ' + state.weekKey,
      lines: lines
    }));
  }

  function downloadSpecial() {
    var lines = ['Send this list direct to the BEK rep.', 'Week of Tuesday ' + state.weekKey, ''];
    ZedBek.orderedItems(state.catalog, 'special').forEach(function (item) {
      lines.push((item.temporary ? '[TEMPORARY] ' : '') + item.name +
        (item.itemNumber ? ' #' + item.itemNumber : ' (no BEK #)') +
        ' | ' + (item.pack || '') +
        ' | on hand ' + (state.onHand[item.id] == null ? 'not counted' : ZedBek.formatQty(state.onHand[item.id]) + ' ' + (item.countUnit || '')));
    });
    ZedPdf.downloadPdf('bek-special-order-' + state.weekKey + '.pdf', ZedPdf.buildPdf({
      title: 'Special order — send direct to the BEK rep',
      lines: lines
    }));
  }

  function applyPending() {
    if (!state.pending || state.pending.diff.empty) return;
    var writes = ZedBek.planUpload(state.catalog, state.pending.diff);
    ZedStorage.applyWrites(db, writes).then(function () {
      return db.ref(ZedStorage.PATHS.drafts + '/guide').remove();
    }).then(function () {
      state.pending = null;
      return reloadLists();
    }).then(function () {
      render();
      renderDiff();
      markSaved();
    }).catch(showError);
  }

  function discardPending() {
    state.pending = null;
    db.ref(ZedStorage.PATHS.drafts + '/guide').remove().then(function () {
      renderDiff();
    }).catch(showError);
  }

  function approvePrices() {
    var approval;
    try { approval = ZedBek.buildPriceApproval(state.catalog, new Date()); }
    catch (err) { showError(err); return; }
    if (!confirm('Copy these BEK prices into the ' + approval.month + ' month-end count? This does not change other months, and it does not change prices until you confirm.')) return;
    ZedStorage.savePriceApproval(db, approval.month, approval).then(function () {
      markSaved();
      alert('Approved. The ' + approval.month + ' month-end count will use these prices.');
    }).catch(showError);
  }

  function onFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      ZedXlsx.parseXlsx(new Uint8Array(reader.result)).then(function (matrix) {
        var parsed = ZedBek.rowsFromMatrix(matrix);
        var diff = ZedBek.diffUpload(state.catalog, parsed);
        state.pending = { diff: diff };
        return db.ref(ZedStorage.PATHS.drafts + '/guide').set({
          schemaVersion: 1,
          kind: parsed.kind,
          rows: parsed.rows,
          savedAt: Date.now()
        });
      }).then(function () {
        renderDiff();
      }).catch(showError);
    };
    reader.readAsArrayBuffer(file);
  }

  document.getElementById('order-container').addEventListener('input', function (event) {
    var input = event.target;
    if (!input.dataset || !input.dataset.hand) return;
    var id = input.dataset.hand;
    var raw = input.value.trim();
    state.onHand[id] = raw === '' ? null : Number(raw);
    if (raw === '') delete state.onHand[id];
    paintNeed(id);
    paintGrand();
    ZedStorage.setOnHand(db, state.locationId, state.weekKey, id, raw === '' ? null : raw).then(markSaved).catch(showError);
  });

  document.getElementById('order-container').addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    var id = button.dataset.hide || button.dataset.restore || button.dataset.unit || button.dataset.par || button.dataset.remove;
    var item = id && state.catalog.items[id];
    if (!item) return;
    if (button.dataset.hide) {
      if (!confirm('Hide "' + item.name + '" on this count? It stays in the catalog.')) return;
      ZedStorage.setHidden(db, state.locationId, id, true).then(function () {
        state.hidden[id] = true;
        render();
        markSaved();
      }).catch(showError);
    } else if (button.dataset.restore) {
      ZedStorage.setHidden(db, state.locationId, id, false).then(function () {
        delete state.hidden[id];
        render();
        markSaved();
      }).catch(showError);
    } else if (button.dataset.unit) {
      var unit = prompt('Count unit for ' + item.name + ' (the order pack stays ' + (item.pack || 'as listed') + ')', item.countUnit || '');
      if (unit == null) return;
      ZedStorage.setCountUnit(db, id, unit.trim()).then(function () {
        item.countUnit = unit.trim();
        render();
        markSaved();
      }).catch(showError);
    } else if (button.dataset.par) {
      var current = ZedBek.parOf(item, state.pars);
      var next = prompt('Par for ' + item.name + ' in ' + (item.countUnit || 'units'), current.value ? String(current.value) : '');
      if (next == null) return;
      var parsed = Number(String(next).trim());
      if (!isFinite(parsed) || parsed < 0) { alert('Enter a number, or 0 for no par.'); return; }
      ZedStorage.setPar(db, state.locationId, id, { value: parsed, unit: item.countUnit || '' }).then(function () {
        state.pars[id] = { value: parsed, unit: item.countUnit || '' };
        render();
        markSaved();
      }).catch(showError);
    } else if (button.dataset.remove) {
      if (!confirm('Remove the temporary item "' + item.name + '"? Its key stays reserved so counts are not reused.')) return;
      ZedStorage.setItemFields(db, id, { removed: true, active: false }).then(function () {
        item.removed = true;
        item.active = false;
        render();
        markSaved();
      }).catch(showError);
    }
  });

  document.getElementById('storePanel').addEventListener('change', function (event) {
    var box = event.target;
    if (!box.dataset || !box.dataset.store) return;
    var next = ZedLocations.withRole(state.locationDoc, box.dataset.store, box.dataset.role, box.checked);
    var loc = next.locations[box.dataset.store];
    state.locationDoc[loc.id] = loc;
    ZedStorage.setLocation(db, loc).then(function () {
      fillLocations();
      render();
      markSaved();
    }).catch(showError);
  });

  document.getElementById('locationSelect').addEventListener('change', function () {
    state.locationId = this.value;
    try { localStorage.setItem('zedops_bek_location', state.locationId); } catch (e) {}
    stopListeners();
    reloadWeek().then(function () { attach(); render(); }).catch(showError);
  });

  document.getElementById('weekSelect').addEventListener('change', function () {
    state.weekKey = this.value || ZedBek.countWeekTuesday(new Date());
    stopListeners();
    reloadWeek().then(function () { attach(); render(); }).catch(showError);
  });

  document.querySelectorAll('input[name="filter"]').forEach(function (radio) {
    radio.addEventListener('change', function () { state.filter = radio.value; render(); });
  });

  document.getElementById('showHiddenToggle').addEventListener('change', function () {
    state.showHidden = this.checked;
    render();
  });

  document.getElementById('guideFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    onFile(file);
  });

  document.getElementById('pdfCount').addEventListener('click', downloadCount);
  document.getElementById('pdfSpecial').addEventListener('click', downloadSpecial);
  document.getElementById('printSpecial').addEventListener('click', function () { window.print(); });

  function showApp(role) {
    state.role = role || 'team';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
    var badge = document.getElementById('roleBadge');
    badge.textContent = state.role === 'admin' ? 'Admin' : 'Team';
    badge.className = 'role-badge ' + state.role;
    document.getElementById('showHiddenLabel').style.display = state.role === 'admin' ? 'inline-block' : 'none';
    document.getElementById('adminTools').style.display = state.role === 'admin' ? 'block' : 'none';
    state.weekKey = ZedBek.countWeekTuesday(new Date());
    document.getElementById('weekSelect').value = state.weekKey;
    setSync(false);
    ZedBek.loadSeed().then(function (seed) {
      return ZedBek.prepareDatabase(db, seed);
    }).then(reloadLists).then(function () {
      attach();
      render();
      renderDiff();
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
