// Scanner, backstock count, split, stores, and rebalance UI.
var currentSection = 'dashboard';
var barcodeMap = {};
var skuMap = {};
var skipList = ['Beef Taco Skillet'];
var splitSettings = {
  stackHeight: 6,
  leaveAtLeast: 5,
  perDish: {},
  shelfPlan: null
};
var splitMemory = {};
var receiveItems = [];
var backstockItems = [];
var pendingBarcode = '';
var pendingQty = 1;
var lastSuggestions = [];

function installInventoryFeatures() {
  wireScanBar();
  return Promise.all([
    splitConfigRef.once('value'),
    skipListRef.once('value'),
    barcodesRef.once('value'),
    storesRef.once('value'),
    skuMapRef.once('value')
  ]).then(function (snaps) {
    var cfg = snaps[0].val();
    if (cfg && typeof cfg === 'object') {
      if (cfg.stackHeight) splitSettings.stackHeight = Math.max(1, parseInt(cfg.stackHeight, 10) || 6);
      if (cfg.leaveAtLeast != null) splitSettings.leaveAtLeast = cfg.leaveAtLeast;
      if (cfg.perDish && typeof cfg.perDish === 'object') splitSettings.perDish = cfg.perDish;
      if (cfg.shelfPlan && typeof cfg.shelfPlan === 'object') splitSettings.shelfPlan = cfg.shelfPlan;
    }
    var savedSkip = snaps[1].val();
    if (Array.isArray(savedSkip) && savedSkip.length) skipList = savedSkip.filter(Boolean);
    else if (savedSkip && typeof savedSkip === 'object') skipList = Object.values(savedSkip).filter(function (v) { return typeof v === 'string'; });
    else skipList = ['Beef Taco Skillet'];
    rememberBarcodes(snaps[2].val());
    var savedStores = snaps[3].val();
    if (savedStores) setStores(savedStores);
    rememberSkuMap(snaps[4].val());
    if (typeof fillAllLocationSelects === 'function') fillAllLocationSelects();
  });
}

function onInventorySection(section) {
  currentSection = section;
  var bar = document.getElementById('scanBar');
  var scanHere = section === 'transfer' || section === 'count' || section === 'receive' || section === 'backstock';
  if (bar) bar.style.display = scanHere ? 'block' : 'none';
  if (section === 'receive') renderReceive();
  if (section === 'backstock') renderBackstock();
  if (section === 'split') buildSplitUI();
  if (section === 'stores') renderStoresEditor();
  if (section === 'transfer' && typeof renderTransferPreview === 'function') renderTransferPreview();
  if (section === 'casevalue' && typeof renderCaseValue === 'function') renderCaseValue();
  if (scanHere) {
    setTimeout(function () {
      var el = document.getElementById('scanInput');
      if (el && !document.querySelector('.modal-overlay.show')) el.focus();
    }, 60);
  }
}

function seedSampleData(force) {
  if (window.dataMode === 'remote' && !force) return Promise.resolve();
  return invRef.once('value').then(function (snap) {
    if (snap.val() && !force) return;
    var list = getStores();
    var a = list[0].id;
    var b = list[1] ? list[1].id : a;
    var cooler = ZedSplit.backstockLocationId(a);
    var inventory = {};
    function put(name, useBy, locs) {
      var key = dishKey(name);
      inventory[key] = inventory[key] || {};
      inventory[key][useBy] = locs;
    }
    function row(pairs) {
      var locs = {};
      pairs.forEach(function (pair) { locs[pair[0]] = pair[1]; });
      return locs;
    }
    put('Tex Mex Turkey Picadillo (1)', '10-16', row([[a, 4], [b, 0]]));
    put('Tex Mex Turkey Picadillo (1)', '10-25', row([[a, 8], [b, 2]]));
    put('1/2# Turkey Chorizo (1)', '10-18', row([[a, 25], [b, 0]]));
    put('1/2# Baked Chicken (1)', '10-18', row([[a, 4], [b, 0]]));
    put('Greek Chicken Bowl', '10-22', row([[a, 0], [b, 10], [cooler, 6]]));
    put('Rustic Chicken Parmesan (2)', '10-20', row([[a, 14], [b, 9]]));
    put('Orange Chicken', '10-24', row([[a, 8], [b, 6]]));
    return invRef.set(inventory).then(function () {
      return barcodesRef.set({
        '012345678905': { code: '012345678905', dishName: 'Tex Mex Turkey Picadillo (1)', source: 'manual' }
      });
    }).then(function () {
      return skipListRef.set(['Beef Taco Skillet']);
    }).then(function () {
      return adjRef.push({
        reason: 'orange_star',
        location: a,
        items: [{ dish: dishKey('1/2# Baked Chicken (1)'), dishName: '1/2# Baked Chicken (1)', qty: 4 }],
        notes: 'Sample orange-star count',
        totalUnits: 4,
        timestamp: ServerValue.TIMESTAMP
      });
    });
  });
}

function backupNote() {
  return 'ZedOps inventory backup from the staging copy. The live Production Hub was not read.';
}

function exportRemotePaths() {
  var keys = ['staging_inv_inventory', 'staging_inv_adjustments', 'staging_inv_counts', 'staging_inv_caseConfig', 'staging_inv_transfers', 'staging_inv_stockouts', 'staging_inv_shelfLife', 'staging_inv_splitConfig', 'staging_inv_barcodes', 'staging_inv_skipList', 'staging_inv_stores', 'staging_inv_skuMap', 'staging_inv_mealCosts'];
  return Promise.all(keys.map(function (key) {
    return db.ref(key).once('value').then(function (snap) {
      return { key: key, val: snap.val() };
    });
  })).then(function (rows) {
    var data = {};
    rows.forEach(function (row) { if (row.val != null) data[row.key] = row.val; });
    return data;
  });
}

function downloadLocalBackup() {
  var ready = db.exportAll ? Promise.resolve(db.exportAll()) : exportRemotePaths();
  return ready.then(function (data) {
    data._note = backupNote();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = 'zedops-staging-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('Backup downloaded');
  });
}

function importLocalBackup(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var data = JSON.parse(String(reader.result || ''));
      if (!data || typeof data !== 'object' || !data.staging_inv_inventory) {
        showToast('That file is not a ZedOps backup');
        return;
      }
      delete data._note;
      var write = db.importAll ? db.importAll(data) : Promise.all(Object.keys(data).filter(function (key) {
        return key.indexOf('staging_inv_') === 0;
      }).map(function (key) { return db.ref(key).set(data[key]); }));
      write.then(function () { location.reload(); });
    } catch (err) {
      showToast('Could not read that file');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function resetSampleData() {
  if (window.dataMode === 'remote') {
    showToast('Sample reset stays off the staging project.');
    return;
  }
  if (!confirm('Replace the counts in this browser with the sample set?')) return;
  db.reset().then(function () { return seedSampleData(true); }).then(function () { location.reload(); });
}

function rememberBarcodes(val) {
  barcodeMap = {};
  if (!val || typeof val !== 'object') return;
  Object.keys(val).forEach(function (code) {
    var row = val[code] || {};
    barcodeMap[code] = { dishName: row.dishName || row.dish || '', source: 'manual' };
  });
}

function rememberSkuMap(val) {
  skuMap = {};
  if (!val || typeof val !== 'object') return;
  Object.keys(val).forEach(function (code) {
    var row = val[code] || {};
    var dish = row.dish || row.dishName || '';
    if (dish) skuMap[code] = { dish: dish, source: 'sku' };
  });
}

function wireScanBar() {
  var input = document.getElementById('scanInput');
  if (!input || input.dataset.wired) return;
  input.dataset.wired = '1';
  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    var code = input.value;
    input.value = '';
    acceptScan(code);
  });
  document.addEventListener('keydown', function (e) {
    if (currentSection !== 'transfer' && currentSection !== 'count' && currentSection !== 'receive' && currentSection !== 'backstock') return;
    var active = document.activeElement;
    if (active && active !== input && isTypingTarget(active)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (active === input || !input.value) return;
      e.preventDefault();
      var code = input.value;
      input.value = '';
      acceptScan(code);
      return;
    }
    if (e.key.length === 1 && active !== input) {
      input.focus();
      input.value += e.key;
      e.preventDefault();
    }
  });
}

function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  var tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function acceptScan(raw) {
  var code = ZedSplit.normalizeBarcode(raw);
  if (!code) return;
  var qtyInput = document.getElementById('scanQty');
  var qty = Math.max(1, parseInt(qtyInput && qtyInput.value, 10) || 1);
  if (qtyInput) qtyInput.value = '1';
  var hit = ZedSplit.lookupBarcode(code, barcodeMap, skuMap);
  if (!hit || !hit.dish) {
    openLinkBarcode(code, qty);
    return;
  }
  routeScan(hit.dish, qty, code);
}

function routeScan(dish, qty, code) {
  if (currentSection === 'transfer') addTransferItem(dish, qty);
  else if (currentSection === 'count') addCountByScan(dish, qty);
  else if (currentSection === 'receive') addReceiveItem(dish, qty);
  else if (currentSection === 'backstock') addBackstockItem(dish, qty);
  else {
    showToast('Open Transfer, Count, Receive, or Backstock, then scan');
    return;
  }
  var last = document.getElementById('scanLast');
  if (last) last.textContent = '+' + qty + '  ' + dish + (code ? '   (' + code + ')' : '');
}

function addCountByScan(name, qty) {
  var dk = dishKey(name);
  var input = null;
  document.querySelectorAll('#countSheet .count-input').forEach(function (el) {
    if (el.dataset.dish === dk) input = el;
  });
  if (!input) {
    showToast(name + ' is not on this count sheet');
    return;
  }
  var cur = input.value === '' ? 0 : (parseInt(input.value, 10) || 0);
  input.value = String(cur + qty);
  var row = input.closest('.count-dish');
  if (row) {
    row.classList.add('scan-hit');
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  updateCountSummary();
}

function renderTransferPreview() {
  var el = document.getElementById('transferPreview');
  if (!el) return;
  var fromEl = document.getElementById('transferFrom');
  var locs = typeof locations === 'function' ? locations() : [];
  var from = fromEl && fromEl.value ? fromEl.value : (locs[0] ? locs[0].id : '');
  var rows = (transferItemsList || []).filter(function (item) { return item.qty > 0; });
  if (!rows.length) {
    el.innerHTML = '';
    return;
  }
  var html = '<h3>Oldest first</h3>';
  rows.forEach(function (item) {
    var lots = lotsAt(dishKey(item.name), from);
    var plan = ZedSplit.allocateOldestFirst(lots, item.qty, today());
    html += '<div class="preview-line"><strong>' + esc(item.name) + '</strong>';
    if (!plan.moves.length) {
      html += '<div class="preview-short">None on hand at ' + esc(locLabel(from)) + '. Short ' + plan.shortfall + '.</div>';
    } else {
      plan.moves.forEach(function (move) {
        html += '<div>Use-by ' + esc(move.useBy) + ' · move ' + move.qty + '</div>';
      });
      if (plan.shortfall > 0) html += '<div class="preview-short">Short ' + plan.shortfall + '.</div>';
    }
    html += '</div>';
  });
  el.innerHTML = html;
}

function lotsAt(dk, loc) {
  var dates = (invData && invData[dk]) || {};
  return Object.keys(dates).map(function (ub) {
    return { useBy: ub, qty: parseInt(dates[ub] && dates[ub][loc], 10) || 0 };
  });
}

function openLinkBarcode(code, qty) {
  pendingBarcode = code;
  pendingQty = qty;
  var label = document.getElementById('barcodeCodeLabel');
  if (label) label.textContent = code;
  var search = document.getElementById('barcodeDishSearch');
  if (search) search.value = '';
  document.getElementById('barcodeModal').classList.add('show');
  searchBarcodeDish('');
  if (search) search.focus();
}

function closeLinkBarcode() {
  var modal = document.getElementById('barcodeModal');
  if (modal) modal.classList.remove('show');
  pendingBarcode = '';
}

function searchBarcodeDish(query) {
  var box = document.getElementById('barcodeDishResults');
  if (!box) return;
  var q = String(query || '').toLowerCase();
  var matches = getAllDishNames().filter(function (name) {
    return !q || name.toLowerCase().indexOf(q) !== -1;
  }).slice(0, 8);
  if (!matches.length) {
    box.innerHTML = '<div class="empty-msg">No matching dish</div>';
    return;
  }
  box.innerHTML = matches.map(function (name) {
    return '<button type="button" class="link-dish" onclick="confirmLinkBarcode(\'' + name.replace(/'/g, "\\'") + '\')">' + esc(name) + '</button>';
  }).join('');
}

function confirmLinkBarcode(name) {
  if (!pendingBarcode || !name) return;
  var code = pendingBarcode;
  var qty = pendingQty || 1;
  barcodesRef.child(code).set({ code: code, dishName: name, source: 'manual', updatedAt: Date.now() }).then(function () {
    barcodeMap[code] = { dishName: name, source: 'manual' };
    closeLinkBarcode();
    routeScan(name, qty, code);
    showToast('Linked ' + code + ' to ' + name);
    renderBarcodeList();
  });
}

function renderBarcodeList() {
  var el = document.getElementById('barcodeList');
  if (!el) return;
  var skuCount = Object.keys(skuMap).length;
  var codes = Object.keys(barcodeMap);
  var html = '<p class="hint">' + skuCount + ' Shopify SKU' + (skuCount === 1 ? '' : 's') + ' loaded. A scan uses the SKU list first. A manual link is only for a code the list does not know.</p>';
  if (!codes.length) {
    el.innerHTML = html + '<p class="hint">No manual links yet.</p>';
    return;
  }
  html += codes.map(function (code) {
    return '<div class="barcode-row"><span>' + esc(code) + '</span><span>' + esc(barcodeMap[code].dishName || '') + '</span></div>';
  }).join('');
  el.innerHTML = html;
}

function importSkuFile(input) {
  readTextFile(input, function (text) {
    var rows = ZedSplit.parseSkuCsv(text);
    if (!rows.length) { showToast('No SKU rows found. Use a Shopify product CSV with Variant SKU and Title.'); return; }
    var incoming = ZedSplit.skuMapFromRows(rows);
    Object.keys(incoming).forEach(function (code) { skuMap[code] = incoming[code]; });
    skuMapRef.set(skuMap).then(function () {
      showToast('Loaded ' + rows.length + ' Shopify SKUs');
      renderBarcodeList();
    });
  });
}

function addReceiveItem(name, qty) {
  var plateEl = document.getElementById('receivePlateDate');
  var plate = (plateEl && plateEl.value) || today();
  var useBy = ZedSplit.addDaysIso(plate, getShelfLife(name));
  var found = receiveItems.find(function (item) { return item.name === name && item.useBy === useBy; });
  if (found) found.qty += qty;
  else receiveItems.push({ name: name, qty: qty, useBy: useBy });
  renderReceive();
}

function renderReceive() {
  var el = document.getElementById('receiveItems');
  if (!el) return;
  renderBarcodeList();
  if (!receiveItems.length) {
    el.innerHTML = '<div class="empty-msg">Scan a meal label, or search for a dish. Each scan adds the quantity above (1 unless you type another number first).</div>';
    return;
  }
  el.innerHTML = receiveItems.map(function (item, idx) {
    return '<div class="transfer-item scan-hit">' +
      '<span class="dish-name">' + esc(item.name) + '<br><span class="hint">Use-by ' + esc(item.useBy) + '</span></span>' +
      '<input type="number" min="1" value="' + item.qty + '" inputmode="numeric" oninput="receiveItems[' + idx + '].qty=parseInt(this.value,10)||0">' +
      '<button class="remove-item" onclick="removeReceiveItem(' + idx + ')">&#10005;</button></div>';
  }).join('');
}

function removeReceiveItem(idx) {
  receiveItems.splice(idx, 1);
  renderReceive();
}

function submitReceive() {
  var loc = document.getElementById('receiveLoc').value;
  var valid = receiveItems.filter(function (item) { return item.qty > 0 && item.useBy; });
  if (!valid.length) { showToast('Scan at least one meal'); return; }
  invRef.once('value').then(function (snap) {
    var data = snap.val() || {};
    var updates = {};
    var logItems = [];
    valid.forEach(function (item) {
      var dk = dishKey(item.name);
      var ub = ZedSplit.isoToUseByKey(item.useBy);
      var current = parseInt(data[dk] && data[dk][ub] && data[dk][ub][loc], 10) || 0;
      updates[dk + '/' + ub + '/' + loc] = current + item.qty;
      logItems.push({ dish: dk, dishName: item.name, useBy: ub, qty: item.qty, direction: 'add' });
    });
    return invRef.update(updates).then(function () {
      return adjRef.push({
        reason: 'received',
        location: loc,
        items: logItems,
        notes: 'Received by scan',
        totalUnits: logItems.reduce(function (s, i) { return s + i.qty; }, 0),
        timestamp: ServerValue.TIMESTAMP
      });
    });
  }).then(function () {
    showToast('Received ' + valid.reduce(function (s, i) { return s + i.qty; }, 0) + ' into ' + locLabel(loc));
    receiveItems = [];
    renderReceive();
    switchSection('dashboard');
  }).catch(function (err) { showToast('Error: ' + err.message); });
}

function addBackstockItem(name, qty) {
  var found = backstockItems.find(function (item) { return item.name === name; });
  if (found) found.qty += qty;
  else backstockItems.push({ name: name, qty: qty });
  renderBackstock();
}

function renderBackstock() {
  var el = document.getElementById('backstockItems');
  if (!el) return;
  var locEl = document.getElementById('backstockLoc');
  var loc = locEl && locEl.value ? locEl.value : '';
  if (!backstockItems.length) {
    el.innerHTML = '<div class="empty-msg">Scan every meal in the cooler. Scanning the same item again adds 1. Only dishes you scan are updated unless you turn on “set unscanned dishes to 0”.</div>';
    return;
  }
  el.innerHTML = backstockItems.map(function (item, idx) {
    var expected = expectedAt(item.name, loc);
    return '<div class="transfer-item">' +
      '<span class="dish-name">' + esc(item.name) + '<br><span class="hint">Expected ' + expected + '</span></span>' +
      '<input type="number" min="0" value="' + item.qty + '" inputmode="numeric" oninput="backstockItems[' + idx + '].qty=parseInt(this.value,10)||0">' +
      '<button class="remove-item" onclick="removeBackstockItem(' + idx + ')">&#10005;</button></div>';
  }).join('');
}

function removeBackstockItem(idx) {
  backstockItems.splice(idx, 1);
  renderBackstock();
}

function expectedAt(name, loc) {
  var dates = (invData && invData[dishKey(name)]) || {};
  var total = 0;
  Object.keys(dates).forEach(function (ub) {
    total += parseInt(dates[ub] && dates[ub][loc], 10) || 0;
  });
  return total;
}

function submitBackstock() {
  var loc = document.getElementById('backstockLoc').value;
  var zeroRest = document.getElementById('backstockZero').checked;
  var items = backstockItems.filter(function (item) { return item.name && item.qty >= 0; })
    .map(function (item) {
      var expected = expectedAt(item.name, loc);
      return { dish: dishKey(item.name), dishName: item.name, expected: expected, actual: item.qty, variance: item.qty - expected };
    });
  if (zeroRest) {
    var seen = {};
    items.forEach(function (item) { seen[item.dish] = true; });
    getAllDishNames().forEach(function (name) {
      var dk = dishKey(name);
      if (seen[dk]) return;
      var expected = expectedAt(name, loc);
      if (expected > 0) items.push({ dish: dk, dishName: name, expected: expected, actual: 0, variance: -expected });
    });
  }
  applyLocationCount(loc, items).then(function () {
    showToast('Backstock count saved at ' + locLabel(loc));
    backstockItems = [];
    renderBackstock();
    switchSection('dashboard');
  }).catch(function (err) {
    if (!err || err.message === 'empty') return;
    showToast('Error: ' + err.message);
  });
}

function blankOnHand(name) {
  var row = { name: name, onHand: {}, backstock: {}, orangeStar: {}, capacity: {} };
  var slot = ZedSplit.shelfSlot(name, { sections: typeof DISH_SECTIONS !== 'undefined' ? DISH_SECTIONS : null, shelfPlan: splitSettings.shelfPlan });
  getStores().forEach(function (store) {
    row.onHand[store.id] = 0;
    row.backstock[store.id] = 0;
    row.orangeStar[store.id] = 0;
    row.capacity[store.id] = ZedSplit.shelfCapacity(store, slot);
  });
  return row;
}

function renderRebalanceCard() {
  var el = document.getElementById('rebalanceCard');
  if (!el) return;
  var byName = {};
  function ensure(name) {
    if (!byName[name]) byName[name] = blankOnHand(name);
    return byName[name];
  }
  Object.keys(invData || {}).forEach(function (dk) {
    var row = ensure(findDishName(dk));
    var dates = invData[dk] || {};
    Object.keys(dates).forEach(function (ub) {
      var locs = dates[ub] || {};
      Object.keys(locs).forEach(function (loc) {
        var qty = parseInt(locs[loc], 10) || 0;
        var storeId = ZedSplit.storeIdFromLocation(loc);
        if (!row.onHand[storeId] && row.onHand[storeId] !== 0) return;
        if (String(loc).slice(-10) === '_backstock') row.backstock[storeId] += qty;
        else row.onHand[storeId] += qty;
      });
    });
  });
  var since = Date.now() - 2 * 24 * 60 * 60 * 1000;
  adjRef.orderByChild('timestamp').once('value').then(function (snap) {
    snap.forEach(function (child) {
      var entry = child.val() || {};
      if (entry.reason !== 'orange_star' || (entry.timestamp || 0) < since) return;
      var storeId = ZedSplit.storeIdFromLocation(entry.location);
      (entry.items || []).forEach(function (item) {
        var row = ensure(item.dishName || findDishName(item.dish));
        if (row.orangeStar[storeId] == null) return;
        row.orangeStar[storeId] += parseInt(item.qty, 10) || 0;
      });
    });
    lastSuggestions = ZedSplit.rebalanceSuggestions({
      dishes: Object.keys(byName).map(function (name) { return byName[name]; }),
      leaveAtLeast: splitSettings.leaveAtLeast || 5,
      skipList: skipList,
      stores: getStores()
    });
    if (!lastSuggestions.length) {
      el.innerHTML = '<h3>Suggested moves</h3><p class="hint">No rebalance today. A suggestion appears when one case is out and another has at least ' + (splitSettings.leaveAtLeast || 5) + ', or when orange-star meals are sitting at a store that still has them.</p>';
      return;
    }
    var html = '<h3>Suggested moves</h3><p class="hint">Suggestions only. Review opens a transfer with the oldest use-by dates filled in. Nothing moves until you log it. A case is never filled past its shelf; extra meals are pointed at backstock.</p>';
    lastSuggestions.forEach(function (s, idx) {
      html += '<div class="alert-row"><span class="dish-name">' + esc(s.name) + '<br><span class="hint">' + esc(s.note) + '</span></span>' +
        '<span class="loc-pill ' + locClass(s.from) + '">' + esc(locLabel(s.from)) + '</span>' +
        '<span>→</span>' +
        '<span class="loc-pill ' + locClass(s.to) + '">' + esc(locLabel(s.to)) + '</span>' +
        '<strong>' + s.qty + '</strong>' +
        '<button class="btn btn-primary" onclick="reviewSuggestion(' + idx + ')">Review</button></div>';
    });
    el.innerHTML = html;
  });
}

function reviewSuggestion(idx) {
  var s = lastSuggestions[idx];
  if (!s) return;
  keepTransferItems = true;
  transferItemsList = [{ name: s.name, qty: s.qty }];
  switchSection('transfer');
  var from = document.getElementById('transferFrom');
  var to = document.getElementById('transferTo');
  if (from) from.value = s.from;
  if (to) to.value = s.to;
  renderTransferItems();
  renderTransferPreview();
}

function findKnownDish(name) {
  var all = getAllDishNames();
  var n = ZedSplit.normalizeName(name);
  return all.find(function (d) { return ZedSplit.normalizeName(d) === n; })
    || all.find(function (d) {
      var dn = ZedSplit.normalizeName(d);
      return n && (dn.indexOf(n) !== -1 || n.indexOf(dn) !== -1);
    }) || name;
}

function currentSplitConfig() {
  return {
    stores: getStores(),
    stackHeight: splitSettings.stackHeight,
    leaveAtLeast: splitSettings.leaveAtLeast,
    perDish: splitSettings.perDish,
    skipList: skipList,
    sections: typeof DISH_SECTIONS !== 'undefined' ? DISH_SECTIONS : null,
    shelfPlan: splitSettings.shelfPlan
  };
}

function readSplitSettingsFromDom() {
  document.querySelectorAll('[data-share-store]').forEach(function (el) {
    var id = el.getAttribute('data-share-store');
    getStores().forEach(function (store) {
      if (store.id === id) store.share = Number(el.value) || 0;
    });
  });
  var height = document.getElementById('splitStackHeight');
  var leave = document.getElementById('splitLeave');
  if (height) splitSettings.stackHeight = Math.max(1, parseInt(height.value, 10) || 6);
  if (leave) splitSettings.leaveAtLeast = Math.max(0, parseInt(leave.value, 10) || 5);
  var status = ZedSplit.sharesStatus(getStores());
  var label = document.getElementById('shareSumLabel');
  if (label) {
    label.textContent = status.ok ? 'Shares total 100%.' : shareProblem(status);
  }
}

function saveSplitSettings() {
  readSplitSettingsFromDom();
  var status = ZedSplit.sharesStatus(getStores());
  if (!status.ok) {
    showToast(shareProblem(status));
    return Promise.reject(new Error('shares'));
  }
  return Promise.all([
    splitConfigRef.set({
      stackHeight: splitSettings.stackHeight,
      leaveAtLeast: splitSettings.leaveAtLeast,
      perDish: splitSettings.perDish,
      shelfPlan: splitSettings.shelfPlan || null
    }),
    storesRef.set(getStores())
  ]);
}

function saveSkipList() {
  var raw = document.getElementById('skipListInput').value || '';
  skipList = raw.split(/\n|,/).map(function (s) { return s.trim(); }).filter(Boolean);
  if (!skipList.length) skipList = ['Beef Taco Skillet'];
  return skipListRef.set(skipList).then(function () {
    showToast('Skip list saved');
    buildSplitUI();
  });
}

function buildSplitUI(keepMemory) {
  var root = document.getElementById('splitRoot');
  if (!root) return;
  if (!keepMemory) readSplitMemory();
  var targets = ZedSplit.splitTargets(getStores());
  var names = getAllDishNames();
  var active = [];
  var skipped = [];
  names.forEach(function (name) {
    if (ZedSplit.isSkipped(name, skipList)) skipped.push(name);
    else active.push(name);
  });
  var html = '';
  html += '<div class="split-config">';
  targets.forEach(function (store) {
    html += field(esc(store.name) + ' %', '<input data-share-store="' + esc(store.id) + '" type="number" min="0" max="100" value="' + store.share + '" oninput="refreshSplitResults()">');
  });
  html += field('Stack height', '<input id="splitStackHeight" type="number" min="1" value="' + splitSettings.stackHeight + '" oninput="refreshSplitResults()">');
  html += field('Leave at least', '<input id="splitLeave" type="number" min="0" value="' + splitSettings.leaveAtLeast + '">');
  html += '</div>';
  html += '<p id="shareSumLabel" class="hint"></p>';
  html += '<p class="hint">Shares for the stores in the split must add up to 100. Pickup orders stay at the store on the order. Deliveries go to the store marked as the delivery hub. The rest follows the percents, in stacks of the height above (one height for every dish). A case stops at that store\'s shelf for the door, and the rest is suggested for that store\'s backstock. Every store in the split gets the dish when there are enough plates left after pickups and deliveries. The smallest batches are about 50 plates. Apply writes only after you confirm.</p>';
  html += '<div class="split-actions">';
  html += '<button class="btn btn-secondary" onclick="document.getElementById(\'platedCsv\').click()">Import plated CSV</button>';
  html += '<button class="btn btn-secondary" onclick="document.getElementById(\'prepaidCsv\').click()">Import prepaid CSV</button>';
  html += '<button class="btn btn-secondary" onclick="document.getElementById(\'platedJson\').click()">Import plate-list JSON</button>';
  html += '<button class="btn btn-secondary" onclick="loadSampleWeek()">Load practice week</button>';
  html += '<button class="btn btn-secondary" onclick="proposeShareChanges()">Propose share changes</button>';
  html += '<button class="btn btn-primary" onclick="saveSplitSettings().then(function(){showToast(\'Split settings saved\')}).catch(function(){})">Save settings</button>';
  html += '</div>';
  html += '<input id="platedCsv" type="file" accept=".csv,text/csv" hidden onchange="importPlatedFile(this)">';
  html += '<input id="prepaidCsv" type="file" accept=".csv,text/csv" hidden onchange="importPrepaidFile(this)">';
  html += '<input id="platedJson" type="file" accept="application/json,.json" hidden onchange="importPlatedFile(this)">';
  html += '<div class="form-group" style="margin:12px 0"><label>Plate date</label><input type="date" id="splitPlateDate" value="' + today() + '"></div>';
  html += '<div class="skip-box"><label>Skip list (one dish per line). Beef Taco Skillet stays off the menu. Orange Chicken is not skipped.</label>';
  html += '<textarea id="skipListInput" rows="3">' + esc(skipList.join('\n')) + '</textarea>';
  html += '<button class="btn btn-secondary" onclick="saveSkipList()">Save skip list</button></div>';
  html += '<div id="shareProposals"></div>';
  html += '<div id="splitCards">';
  active.forEach(function (name) { html += splitCard(name); });
  html += '</div>';
  if (skipped.length) {
    html += '<details class="skip-details"><summary>Skipped (' + skipped.length + ')</summary>';
    skipped.forEach(function (name) { html += '<div class="hint" style="padding:6px 0;">' + esc(name) + '</div>'; });
    html += '</details>';
  }
  root.innerHTML = html;
  refreshSplitResults();
}

function shareProblem(status) {
  if (status.missing && status.missing.length) return 'Give ' + status.missing.join(', ') + ' a percent above 0. A production kitchen can stay at 0.';
  return 'Shares add up to ' + status.sum + '%. They need to add up to 100.';
}

function field(label, control) {
  return '<label class="split-field"><span>' + label + '</span>' + control + '</label>';
}

function splitCard(name) {
  var mem = splitMemory[name] || {};
  var pickups = mem.pickups || {};
  var inputs = numField('Plated', 'plated', mem.plated, '');
  ZedSplit.splitTargets(getStores()).forEach(function (store) {
    if (!store.hasPickup) return;
    inputs += numField('Pickup ' + store.name, 'pickup', pickups[store.id], store.id);
  });
  inputs += numField('Delivery', 'delivery', mem.delivery, '');
  return '<div class="split-card" data-dish="' + esc(name) + '">' +
    '<div class="split-card-head"><label><input type="checkbox" class="split-include" checked> Apply</label><strong>' + esc(name) + '</strong></div>' +
    '<div class="split-inputs">' + inputs + '</div>' +
    '<div class="split-result"></div></div>';
}

function numField(label, cls, value, storeId) {
  var v = value ? String(value) : '';
  var data = storeId ? ' data-store="' + storeId + '"' : '';
  return '<label><span>' + esc(label) + '</span><input class="' + cls + '"' + data + ' type="number" min="0" inputmode="numeric" value="' + v + '" oninput="refreshSplitResults()"></label>';
}

function readSplitMemory() {
  document.querySelectorAll('#splitCards .split-card').forEach(function (card) {
    var name = card.dataset.dish;
    if (!name) return;
    var pickups = {};
    card.querySelectorAll('.pickup').forEach(function (el) {
      if (!el.dataset.store) return;
      pickups[el.dataset.store] = el.value !== '' ? (parseInt(el.value, 10) || 0) : 0;
    });
    splitMemory[name] = {
      plated: numVal(card, '.plated'),
      pickups: pickups,
      delivery: numVal(card, '.delivery')
    };
  });
}

function numVal(card, sel) {
  var el = card.querySelector(sel);
  return el && el.value !== '' ? (parseInt(el.value, 10) || 0) : 0;
}

function dishInput(name) {
  var mem = splitMemory[name] || {};
  return {
    dish: name,
    plated: mem.plated || 0,
    pickups: mem.pickups || {},
    delivery: mem.delivery || 0
  };
}

function refreshSplitResults() {
  readSplitSettingsFromDom();
  readSplitMemory();
  document.querySelectorAll('#splitCards .split-card').forEach(function (card) {
    var name = card.dataset.dish;
    var mem = splitMemory[name] || {};
    var result = ZedSplit.splitDish(dishInput(name), currentSplitConfig());
    var box = card.querySelector('.split-result');
    if (!mem.plated) {
      box.innerHTML = '<span class="hint">Enter a plated count</span>';
      return;
    }
    var warn = result.warnings.length ? '<div class="preview-short">' + esc(result.warnings.join(' · ')) + '</div>' : '';
    var lines = result.allocations.map(function (slot) {
      var cooler = slot.backstock ? ' + ' + slot.backstock + ' backstock' : '';
      return esc(slot.name) + ' case ' + slot.caseQty + cooler;
    }).join(' · ');
    var caps = result.allocations.map(function (slot) {
      return esc(slot.name) + ' cap ' + slot.capacity + ' (door ' + esc(slot.door) + ' ' + esc(slot.shelf) + ')';
    }).join(' · ');
    box.innerHTML = '<strong>' + lines + '</strong>' +
      '<div class="hint">Stack ' + result.stackSize + ' · ' + caps + '</div>' + warn;
  });
}

function collectSplitResults() {
  readSplitSettingsFromDom();
  readSplitMemory();
  var rows = [];
  document.querySelectorAll('#splitCards .split-card').forEach(function (card) {
    var name = card.dataset.dish;
    var include = card.querySelector('.split-include').checked;
    var result = ZedSplit.splitDish(dishInput(name), currentSplitConfig());
    result.include = include;
    rows.push(result);
  });
  return rows;
}

function applySplit() {
  readSplitSettingsFromDom();
  var status = ZedSplit.sharesStatus(getStores());
  if (!status.ok) {
    showToast(shareProblem(status));
    return;
  }
  var results = collectSplitResults().filter(function (row) { return row.include && !row.skipped && row.plated > 0; });
  if (!results.length) { showToast('Enter plated counts and leave Apply checked'); return; }
  var bad = results.filter(function (row) { return ZedSplit.allocationTotal(row) !== row.plated; });
  if (bad.length) { showToast('A split does not add up. Nothing was written.'); return; }
  var over = results.some(function (row) {
    return row.allocations.some(function (slot) { return slot.caseQty > slot.capacity; });
  });
  if (over) { showToast('A case is over its shelf. Nothing was written.'); return; }
  var warnCount = results.filter(function (row) { return row.warnings.length; }).length;
  var message = 'Set case and backstock counts for ' + results.length + ' dishes? Use-by is the plate date plus each dish\'s shelf life. This replaces that use-by date and leaves older dates in place.';
  if (warnCount) message += ' ' + warnCount + ' dish(es) have a warning.';
  message += ' A backup downloads first. This does not write to the live Production Hub.';
  if (!confirm(message)) return;
  saveSplitSettings().catch(function () {});
  downloadLocalBackup();
  var plateDate = document.getElementById('splitPlateDate').value || today();
  var updates = {};
  var logItems = [];
  results.forEach(function (row) {
    var useBy = ZedSplit.isoToUseByKey(ZedSplit.addDaysIso(plateDate, getShelfLife(row.dish)));
    var dk = dishKey(row.dish);
    row.allocations.forEach(function (slot) {
      updates[dk + '/' + useBy + '/' + slot.id] = slot.caseQty;
      if (slot.backstockId) updates[dk + '/' + useBy + '/' + slot.backstockId] = slot.backstock;
    });
    logItems.push({
      dish: dk,
      dishName: row.dish,
      useBy: useBy,
      plated: row.plated,
      allocations: row.allocations.map(function (slot) {
        return { id: slot.id, name: slot.name, caseQty: slot.caseQty, backstock: slot.backstock };
      })
    });
  });
  invRef.update(updates).then(function () {
    return transfersRef.push({
      kind: 'split',
      from: 'plated',
      to: 'cases',
      plateDate: plateDate,
      items: logItems,
      totalUnits: logItems.reduce(function (s, i) { return s + i.plated; }, 0),
      timestamp: ServerValue.TIMESTAMP
    });
  }).then(function () {
    showToast('Split saved for ' + results.length + ' dishes');
    switchSection('dashboard');
  }).catch(function (err) { showToast('Error: ' + err.message); });
}

function loadSampleWeek() {
  var sample = {
    'Tex Mex Turkey Picadillo (1)': 100,
    'Bacon & Gruyere Egg Bites w/ Cauliflower Hash (2)': 51,
    'Chicken & Italian Sausage Over Pasta (2)': 225,
    '1/2# Baked Chicken (1)': 10,
    '1/2# Turkey Chorizo (1)': 20,
    'GF Chicken ZedStrips Over Mac-N-Cheese (4)': 75,
    'Rustic Chicken Parmesan (2)': 230,
    'Arroz Con Pollo (2)': 90,
    'Orange Chicken': 36,
    'Beef Taco Skillet (2)': 12
  };
  var pickupStores = ZedSplit.splitTargets(getStores()).filter(function (store) { return store.hasPickup; });
  Object.keys(sample).forEach(function (name) {
    splitMemory[findKnownDish(name)] = { plated: sample[name], pickups: {}, delivery: 0 };
  });
  var pic = splitMemory[findKnownDish('Tex Mex Turkey Picadillo (1)')];
  if (pickupStores[0]) pic.pickups[pickupStores[0].id] = 8;
  if (pickupStores[1]) pic.pickups[pickupStores[1].id] = 5;
  splitMemory[findKnownDish('Arroz Con Pollo (2)')].delivery = 6;
  buildSplitUI(true);
  showToast('Practice counts loaded. These are not live plate-list numbers.');
}

function importPlatedFile(input) {
  readTextFile(input, function (text) {
    var trimmed = text.trim();
    var rows = [];
    if (trimmed.charAt(0) === '{') {
      var data = JSON.parse(trimmed);
      var days = Object.keys(data).filter(function (key) { return data[key] && typeof data[key] === 'object'; });
      rows = ZedSplit.platedFromProduction(data, days.length ? days : Object.keys(data));
      showToast('Imported plated counts from a file (' + rows.length + ' dishes).');
    } else {
      trimmed.split(/\r?\n/).forEach(function (line, idx) {
        if (!line.trim()) return;
        var cells = line.split(',').map(function (c) { return c.trim().replace(/^"|"$/g, ''); });
        if (idx === 0 && /dish|name/i.test(cells[0])) return;
        var qty = parseInt(cells[1], 10);
        if (cells[0] && !isNaN(qty)) rows.push({ dish: cells[0], plated: qty });
      });
    }
    rows.forEach(function (row) {
      var name = findKnownDish(row.dish);
      var prev = splitMemory[name] || {};
      splitMemory[name] = {
        plated: row.plated,
        pickups: prev.pickups || {},
        delivery: prev.delivery || 0
      };
    });
    buildSplitUI(true);
  });
}

function importPrepaidFile(input) {
  readTextFile(input, function (text) {
    var totals = ZedSplit.aggregateOrders(ZedSplit.parsePrepaidCsv(text, getStores()));
    totals.forEach(function (row) {
      var name = findKnownDish(row.dish);
      var prev = splitMemory[name] || { plated: 0, pickups: {}, delivery: 0 };
      var pickups = Object.assign({}, prev.pickups || {});
      Object.keys(row.pickups || {}).forEach(function (id) {
        pickups[id] = (pickups[id] || 0) + row.pickups[id];
      });
      splitMemory[name] = {
        plated: prev.plated || 0,
        pickups: pickups,
        delivery: (prev.delivery || 0) + row.delivery
      };
    });
    buildSplitUI(true);
    showToast('Prepaid rows added. Deliveries count toward the delivery hub.');
  });
}

function readTextFile(input, cb) {
  var file = input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    try { cb(String(reader.result || '')); }
    catch (err) { showToast('Could not read that file'); }
  };
  reader.readAsText(file);
  input.value = '';
}

function proposeShareChanges() {
  var since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  Promise.all([
    stockoutsRef.orderByChild('timestamp').once('value'),
    adjRef.orderByChild('timestamp').once('value')
  ]).then(function (snaps) {
    var stockouts = [];
    var stars = [];
    snaps[0].forEach(function (child) {
      var entry = child.val() || {};
      if ((entry.timestamp || 0) < since) return;
      var storeId = ZedSplit.storeIdFromLocation(entry.location);
      (entry.items || []).forEach(function (item) {
        stockouts.push({ name: item.dishName || findDishName(item.dish), store: storeId });
      });
    });
    snaps[1].forEach(function (child) {
      var entry = child.val() || {};
      if (entry.reason !== 'orange_star' || (entry.timestamp || 0) < since) return;
      var storeId = ZedSplit.storeIdFromLocation(entry.location);
      (entry.items || []).forEach(function (item) {
        stars.push({ name: item.dishName || findDishName(item.dish), store: storeId, qty: item.qty });
      });
    });
    var dishes = Object.keys(splitMemory).map(function (name) {
      return { name: name, plated: splitMemory[name].plated || 0 };
    });
    var proposals = ZedSplit.proposeShareShifts({
      stores: getStores(),
      stackHeight: splitSettings.stackHeight,
      skipList: skipList,
      perDish: splitSettings.perDish,
      dishes: dishes,
      stockouts: stockouts,
      orangeStar: stars
    });
    var box = document.getElementById('shareProposals');
    if (!proposals.length) {
      box.innerHTML = '<p class="hint">No share change proposed from the last 7 days of stockouts and orange-star logs.</p>';
      return;
    }
    box.innerHTML = '<h3>Proposed share changes</h3><p class="hint">Nothing changes until you approve a row. Approved shares still have to add up to 100.</p>' +
      proposals.map(function (p, idx) {
        var bits = Object.keys(p.currentShares).map(function (id) {
          var store = getStores().find(function (item) { return item.id === id; });
          var label = store ? store.name : id;
          return label + ' ' + Math.round(p.currentShares[id]) + '% → ' + Math.round(p.nextShares[id]) + '%';
        }).join(', ');
        return '<div class="alert-row"><span class="dish-name">' + esc(p.dish) + '<br><span class="hint">' + esc(p.note) + ' ' + esc(bits) + '</span></span>' +
          (p.direction === 'none' ? '' : '<button class="btn btn-primary" onclick="approveShare(' + idx + ')">Approve</button>') + '</div>';
      }).join('');
    window._shareProposals = proposals;
  });
}

function approveShare(idx) {
  var p = (window._shareProposals || [])[idx];
  if (!p || p.direction === 'none') return;
  splitSettings.perDish[p.dish] = p.nextShares;
  saveSplitSettings().then(function () {
    showToast('Saved a new share for ' + p.dish + '. Counts were not moved.');
    refreshSplitResults();
  }).catch(function () {});
}

function renderStoresEditor() {
  var root = document.getElementById('storesRoot');
  if (!root) return;
  var stores = getStores();
  var status = ZedSplit.sharesStatus(stores);
  var html = '<p class="hint">Split shares total <strong>' + status.sum + '%</strong>' + (status.ok ? '.' : '. Change them until they add up to 100.') + '</p>';
  stores.forEach(function (store, index) {
    html += '<div class="split-card" data-store-index="' + index + '">';
    html += '<strong>' + esc(store.name) + '</strong> <span class="hint">' + esc(store.id) + '</span>';
    html += '<div class="split-inputs">';
    html += '<label><span>Name</span><input data-field="name" value="' + esc(store.name) + '"></label>';
    html += '<label><span>Share %</span><input data-field="share" type="number" min="0" max="100" value="' + store.share + '"></label>';
    html += '</div>';
    html += storeCheck('Pickup orders', 'hasPickup', store.hasPickup);
    html += storeCheck('Delivery hub', 'isDeliveryHub', store.isDeliveryHub);
    html += storeCheck('Production kitchen', 'isProductionKitchen', store.isProductionKitchen);
    html += storeCheck('Backstock cooler', 'backstock', store.backstock);
    html += '<p class="hint">Shelf capacity for this store. A full shelf is one dish. A half shelf is each dish when two dishes share the shelf. Door 6 at the first store starts lower because a rack blocks it. Change the numbers if a door is different.</p>';
    store.doors.forEach(function (door, doorIndex) {
      html += '<div class="split-inputs">' +
        '<label><span>Door</span><input data-door="' + doorIndex + '" data-door-field="id" value="' + esc(String(door.id)) + '"></label>' +
        '<label><span>Full</span><input data-door="' + doorIndex + '" data-door-field="full" type="number" min="0" value="' + door.full + '"></label>' +
        '<label><span>Half</span><input data-door="' + doorIndex + '" data-door-field="half" type="number" min="0" value="' + door.half + '"></label>' +
        '</div>';
    });
    html += '</div>';
  });
  html += '<div class="split-config">' + field('New store name', '<input id="newStoreName" placeholder="Store 3 or Commissary">') + '</div>';
  html += '<div class="split-actions">';
  html += '<button class="btn btn-secondary" type="button" onclick="addRetailStore()">Add store</button>';
  html += '<button class="btn btn-secondary" type="button" onclick="addKitchen()">Add commissary</button>';
  html += '<button class="btn btn-primary" type="button" onclick="saveStoresFromEditor()">Save stores</button>';
  html += '</div>';
  root.innerHTML = html;
}

function storeCheck(label, fieldName, checked) {
  return '<label class="hint" style="display:flex;gap:8px;align-items:center;margin:6px 0;"><input type="checkbox" data-field="' + fieldName + '"' + (checked ? ' checked' : '') + '> ' + label + '</label>';
}

function readStoresFromEditor() {
  var next = ZedSplit.normalizeStores(getStores());
  document.querySelectorAll('#storesRoot .split-card').forEach(function (card) {
    var index = parseInt(card.getAttribute('data-store-index'), 10);
    var store = next[index];
    if (!store) return;
    var nameEl = card.querySelector('[data-field="name"]');
    var shareEl = card.querySelector('[data-field="share"]');
    if (nameEl && nameEl.value.trim()) store.name = nameEl.value.trim();
    if (shareEl) store.share = Number(shareEl.value) || 0;
    ['hasPickup', 'isDeliveryHub', 'isProductionKitchen', 'backstock'].forEach(function (fieldName) {
      var box = card.querySelector('[data-field="' + fieldName + '"]');
      if (box) store[fieldName] = !!box.checked;
    });
    store.doors.forEach(function (door, doorIndex) {
      var idEl = card.querySelector('[data-door="' + doorIndex + '"][data-door-field="id"]');
      var fullEl = card.querySelector('[data-door="' + doorIndex + '"][data-door-field="full"]');
      var halfEl = card.querySelector('[data-door="' + doorIndex + '"][data-door-field="half"]');
      if (idEl && idEl.value.trim()) door.id = idEl.value.trim();
      if (fullEl) door.full = Math.max(0, parseInt(fullEl.value, 10) || 0);
      if (halfEl) door.half = Math.max(0, parseInt(halfEl.value, 10) || 0);
    });
  });
  var hubs = next.filter(function (store) { return store.isDeliveryHub; });
  if (hubs.length > 1) {
    var keep = hubs[hubs.length - 1].id;
    next.forEach(function (store) { store.isDeliveryHub = store.id === keep; });
  }
  return ZedSplit.normalizeStores(next);
}

function saveStoresFromEditor() {
  var next = readStoresFromEditor();
  var status = ZedSplit.sharesStatus(next);
  setStores(next);
  if (!status.ok) {
    renderStoresEditor();
    showToast(shareProblem(status));
    return;
  }
  storesRef.set(getStores()).then(function () {
    if (typeof fillAllLocationSelects === 'function') fillAllLocationSelects();
    renderStoresEditor();
    showToast('Stores saved');
  }).catch(function (err) { showToast('Error: ' + err.message); });
}

function addRetailStore() {
  var nameEl = document.getElementById('newStoreName');
  var name = nameEl && nameEl.value.trim() ? nameEl.value.trim() : 'Store 3';
  var next = readStoresFromEditor();
  next = ZedSplit.addStore(next, { name: name, hasPickup: true, share: 0 });
  setStores(next);
  renderStoresEditor();
  showToast('Added ' + name + '. Set the percents so they add up to 100, then save.');
}

var caseValueCosts = { tray: 0, film: 0, gas: 0, product: {} };
var caseValueAnchor = new Date();
var caseValueLoaded = false;

function captureCaseValueForm() {
  var tray = document.getElementById('costTray');
  if (!tray) return;
  var next = TransferCost.readCosts({
    tray: tray.value,
    film: document.getElementById('costFilm').value,
    gas: document.getElementById('costGas').value,
    product: caseValueCosts.product
  });
  document.querySelectorAll('[data-product-dish]').forEach(function (input) {
    var name = input.getAttribute('data-product-dish');
    var amount = TransferCost.money(input.value);
    if (amount == null) delete next.product[name];
    else next.product[name] = amount;
  });
  caseValueCosts = next;
}

function fillCaseValueRates() {
  var tray = document.getElementById('costTray');
  var film = document.getElementById('costFilm');
  var gas = document.getElementById('costGas');
  if (tray && document.activeElement !== tray) tray.value = caseValueCosts.tray ? caseValueCosts.tray : '';
  if (film && document.activeElement !== film) film.value = caseValueCosts.film ? caseValueCosts.film : '';
  if (gas && document.activeElement !== gas) gas.value = caseValueCosts.gas ? caseValueCosts.gas : '';
}

function renderCaseValue() {
  var report = document.getElementById('caseValueReport');
  if (!report) return;
  var draw = function () {
    var week = TransferCost.transferWeek(caseValueAnchor);
    var label = document.getElementById('caseValueWeekLabel');
    if (label) label.textContent = week.label;
    fillCaseValueRates();
    if (!transfersRef) return;
    transfersRef.once('value').then(function (snap) {
      var entries = [];
      snap.forEach(function (child) { entries.push(child.val()); });
      report.innerHTML = TransferCost.reportHtml(TransferCost.summarize(entries, caseValueCosts, locations(), week));
    }).catch(function (err) { report.textContent = err.message; });
  };
  if (caseValueLoaded || !mealCostsRef) { draw(); return; }
  mealCostsRef.once('value').then(function (snap) {
    caseValueCosts = TransferCost.readCosts(snap.val());
    caseValueLoaded = true;
    draw();
  }).catch(function () { caseValueLoaded = true; draw(); });
}

function refreshCaseValue() {
  captureCaseValueForm();
  var report = document.getElementById('caseValueReport');
  if (!report || !transfersRef) return;
  var week = TransferCost.transferWeek(caseValueAnchor);
  transfersRef.once('value').then(function (snap) {
    var entries = [];
    snap.forEach(function (child) { entries.push(child.val()); });
    report.innerHTML = TransferCost.reportHtml(TransferCost.summarize(entries, caseValueCosts, locations(), week));
  });
}

function shiftCaseValueWeek(delta) {
  captureCaseValueForm();
  var week = TransferCost.transferWeek(caseValueAnchor);
  var moved = TransferCost.shiftWeek(week, delta);
  caseValueAnchor = new Date(moved.start + 12 * 60 * 60 * 1000);
  renderCaseValue();
}

function saveCaseValueCosts() {
  captureCaseValueForm();
  mealCostsRef.set({
    tray: caseValueCosts.tray,
    film: caseValueCosts.film,
    gas: caseValueCosts.gas,
    product: caseValueCosts.product
  }).then(function () {
    caseValueLoaded = true;
    showToast('Meal costs saved. Labor is not included.');
    renderCaseValue();
  }).catch(function (err) { showToast('Error: ' + err.message); });
}

function addKitchen() {
  var nameEl = document.getElementById('newStoreName');
  var name = nameEl && nameEl.value.trim() ? nameEl.value.trim() : 'Commissary';
  var next = readStoresFromEditor();
  next = ZedSplit.addStore(next, { name: name, isProductionKitchen: true, hasPickup: false, share: 0, backstock: true });
  setStores(next);
  renderStoresEditor();
  showToast('Added ' + name + ' as a production kitchen. You can transfer to it. It stays out of the split until it has a share.');
}
