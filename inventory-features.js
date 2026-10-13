// Scanner, backstock count, split, and rebalance UI.
// Talks only to the local inventory store (window.db). No network calls.
var currentSection = 'dashboard';
var barcodeMap = {};
var skipList = ['Beef Taco Skillet'];
var splitSettings = {
  colonnadeShare: 0.6,
  stackRegular: 6,
  stackSmall: 7,
  smallMatchers: ['1/2#'],
  leaveAtLeast: 5,
  perDish: {}
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
    barcodesRef.once('value')
  ]).then(function (snaps) {
    var cfg = snaps[0].val();
    if (cfg && typeof cfg === 'object') {
      if (cfg.colonnadeShare != null) splitSettings.colonnadeShare = ZedSplit.asShare(cfg.colonnadeShare, 0.6);
      if (cfg.stackRegular) splitSettings.stackRegular = cfg.stackRegular;
      if (cfg.stackSmall) splitSettings.stackSmall = cfg.stackSmall;
      if (cfg.smallMatchers) splitSettings.smallMatchers = cfg.smallMatchers;
      if (cfg.leaveAtLeast != null) splitSettings.leaveAtLeast = cfg.leaveAtLeast;
      if (cfg.perDish) splitSettings.perDish = cfg.perDish;
    }
    var savedSkip = snaps[1].val();
    if (Array.isArray(savedSkip) && savedSkip.length) skipList = savedSkip.filter(Boolean);
    else if (savedSkip && typeof savedSkip === 'object') skipList = Object.values(savedSkip).filter(function (v) { return typeof v === 'string'; });
    else skipList = ['Beef Taco Skillet'];
    rememberBarcodes(snaps[2].val());
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
  if (section === 'transfer' && typeof renderTransferPreview === 'function') renderTransferPreview();
  if (scanHere) {
    setTimeout(function () {
      var el = document.getElementById('scanInput');
      if (el && !document.querySelector('.modal-overlay.show')) el.focus();
    }, 60);
  }
}

function seedSampleData(force) {
  return invRef.once('value').then(function (snap) {
    if (snap.val() && !force) return;
    var inventory = {};
    function put(name, useBy, locs) {
      var key = dishKey(name);
      inventory[key] = inventory[key] || {};
      inventory[key][useBy] = locs;
    }
    put('Tex Mex Turkey Picadillo (1)', '10-16', { colonnade: 4, rim: 0 });
    put('Tex Mex Turkey Picadillo (1)', '10-25', { colonnade: 8, rim: 2 });
    put('1/2# Turkey Chorizo (1)', '10-18', { colonnade: 25, rim: 0 });
    put('1/2# Baked Chicken (1)', '10-18', { colonnade: 4, rim: 0 });
    put('Greek Chicken Bowl', '10-22', { colonnade: 0, rim: 10, colonnade_backstock: 6 });
    put('Rustic Chicken Parmesan (2)', '10-20', { colonnade: 14, rim: 9 });
    put('Orange Chicken', '10-24', { colonnade: 8, rim: 6 });
    return invRef.set(inventory).then(function () {
      return barcodesRef.set({
        '012345678905': { code: '012345678905', dishName: 'Tex Mex Turkey Picadillo (1)' }
      });
    }).then(function () {
      return skipListRef.set(['Beef Taco Skillet']);
    }).then(function () {
      return adjRef.push({
        reason: 'orange_star',
        location: 'colonnade',
        items: [{ dish: dishKey('1/2# Baked Chicken (1)'), dishName: '1/2# Baked Chicken (1)', qty: 4 }],
        notes: 'Sample orange-star count, stored only in this browser',
        totalUnits: 4,
        timestamp: ServerValue.TIMESTAMP
      });
    });
  });
}

function downloadLocalBackup() {
  var data = db.exportAll();
  data._note = 'Local ZedOps inventory backup. Not from Firebase. The live project was not read.';
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  var stamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.download = 'zedops-local-backup-' + stamp + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('Backup downloaded to this device');
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
      db.importAll(data).then(function () { location.reload(); });
    } catch (err) {
      showToast('Could not read that file');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function resetSampleData() {
  if (!confirm('Replace the counts saved in this browser with the sample set? This does not contact Firebase.')) return;
  db.reset().then(function () { return seedSampleData(true); }).then(function () { location.reload(); });
}

function rememberBarcodes(val) {
  barcodeMap = {};
  if (!val || typeof val !== 'object') return;
  Object.keys(val).forEach(function (code) {
    var row = val[code] || {};
    barcodeMap[code] = { dishName: row.dishName || row.dish || '' };
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
  var hit = ZedSplit.lookupBarcode(code, barcodeMap);
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
  var from = fromEl ? fromEl.value : 'colonnade';
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
  barcodesRef.child(code).set({ code: code, dishName: name, updatedAt: Date.now() }).then(function () {
    barcodeMap[code] = { dishName: name };
    closeLinkBarcode();
    routeScan(name, qty, code);
    showToast('Linked ' + code + ' to ' + name);
    renderBarcodeList();
  });
}

function renderBarcodeList() {
  var el = document.getElementById('barcodeList');
  if (!el) return;
  var codes = Object.keys(barcodeMap);
  if (!codes.length) {
    el.innerHTML = '<p class="hint">No barcodes linked yet. Scan one and pick the dish.</p>';
    return;
  }
  el.innerHTML = codes.map(function (code) {
    return '<div class="barcode-row"><span>' + esc(code) + '</span><span>' + esc(barcodeMap[code].dishName || '') + '</span></div>';
  }).join('');
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
  var loc = (document.getElementById('backstockLoc') || {}).value || 'colonnade_backstock';
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

function renderRebalanceCard() {
  var el = document.getElementById('rebalanceCard');
  if (!el) return;
  var byName = {};
  function ensure(name) {
    if (!byName[name]) byName[name] = { name: name, colonnade: 0, rim: 0, colonnadeBackstock: 0, rimBackstock: 0, orangeStarColonnade: 0, orangeStarRim: 0 };
    return byName[name];
  }
  Object.keys(invData || {}).forEach(function (dk) {
    var row = ensure(findDishName(dk));
    var dates = invData[dk] || {};
    Object.keys(dates).forEach(function (ub) {
      var locs = dates[ub] || {};
      row.colonnade += parseInt(locs.colonnade, 10) || 0;
      row.rim += parseInt(locs.rim, 10) || 0;
      row.colonnadeBackstock += parseInt(locs.colonnade_backstock, 10) || 0;
      row.rimBackstock += parseInt(locs.rim_backstock, 10) || 0;
    });
  });
  var since = Date.now() - 2 * 24 * 60 * 60 * 1000;
  adjRef.orderByChild('timestamp').once('value').then(function (snap) {
    snap.forEach(function (child) {
      var entry = child.val() || {};
      if (entry.reason !== 'orange_star' || (entry.timestamp || 0) < since) return;
      var store = entry.location === 'rim' ? 'rim' : 'colonnade';
      (entry.items || []).forEach(function (item) {
        var row = ensure(item.dishName || findDishName(item.dish));
        row[store === 'rim' ? 'orangeStarRim' : 'orangeStarColonnade'] += parseInt(item.qty, 10) || 0;
      });
    });
    lastSuggestions = ZedSplit.rebalanceSuggestions({
      dishes: Object.values(byName),
      leaveAtLeast: splitSettings.leaveAtLeast || 5,
      skipList: skipList
    });
    if (!lastSuggestions.length) {
      el.innerHTML = '<h3>Suggested moves</h3><p class="hint">No rebalance today. A suggestion appears when one case is out and the other has at least ' + (splitSettings.leaveAtLeast || 5) + ', or when orange-star meals are sitting at the store that still has them.</p>';
      return;
    }
    var html = '<h3>Suggested moves</h3><p class="hint">Suggestions only. Review opens a transfer with the oldest use-by dates filled in. Nothing moves until you log it.</p>';
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
    colonnadeShare: splitSettings.colonnadeShare,
    stackRegular: splitSettings.stackRegular,
    stackSmall: splitSettings.stackSmall,
    smallMatchers: splitSettings.smallMatchers,
    leaveAtLeast: splitSettings.leaveAtLeast,
    perDish: splitSettings.perDish,
    skipList: skipList
  };
}

function readSplitSettingsFromDom() {
  var share = document.getElementById('splitColonnadeShare');
  var regular = document.getElementById('splitStackRegular');
  var small = document.getElementById('splitStackSmall');
  var leave = document.getElementById('splitLeave');
  if (share) splitSettings.colonnadeShare = ZedSplit.asShare(share.value, 0.6);
  if (regular) splitSettings.stackRegular = Math.max(1, parseInt(regular.value, 10) || 6);
  if (small) splitSettings.stackSmall = Math.max(1, parseInt(small.value, 10) || 7);
  if (leave) splitSettings.leaveAtLeast = Math.max(0, parseInt(leave.value, 10) || 5);
  var rim = document.getElementById('splitRimShareLabel');
  if (rim) rim.textContent = Math.round((1 - splitSettings.colonnadeShare) * 100) + '%';
}

function saveSplitSettings() {
  readSplitSettingsFromDom();
  return splitConfigRef.set({
    colonnadeShare: splitSettings.colonnadeShare,
    stackRegular: splitSettings.stackRegular,
    stackSmall: splitSettings.stackSmall,
    smallMatchers: splitSettings.smallMatchers,
    leaveAtLeast: splitSettings.leaveAtLeast,
    perDish: splitSettings.perDish
  });
}

function saveSkipList() {
  var raw = document.getElementById('skipListInput').value || '';
  skipList = raw.split(/\n|,/).map(function (s) { return s.trim(); }).filter(Boolean);
  if (!skipList.length) skipList = ['Beef Taco Skillet'];
  return skipListRef.set(skipList).then(function () {
    showToast('Skip list saved in this browser');
    buildSplitUI();
  });
}

function buildSplitUI(keepMemory) {
  var root = document.getElementById('splitRoot');
  if (!root) return;
  if (!keepMemory) readSplitMemory();
  var sharePct = Math.round(splitSettings.colonnadeShare * 100);
  var names = getAllDishNames();
  var active = [];
  var skipped = [];
  names.forEach(function (name) {
    if (ZedSplit.isSkipped(name, skipList)) skipped.push(name);
    else active.push(name);
  });
  var html = '';
  html += '<div class="split-config">';
  html += field('Colonnade share %', '<input id="splitColonnadeShare" type="number" min="0" max="100" value="' + sharePct + '" oninput="refreshSplitResults()">');
  html += field('Rim share', '<strong id="splitRimShareLabel">' + (100 - sharePct) + '%</strong>');
  html += field('Regular stack', '<input id="splitStackRegular" type="number" min="1" value="' + splitSettings.stackRegular + '" oninput="refreshSplitResults()">');
  html += field('Small stack', '<input id="splitStackSmall" type="number" min="1" value="' + splitSettings.stackSmall + '" oninput="refreshSplitResults()">');
  html += field('Leave at least', '<input id="splitLeave" type="number" min="0" value="' + splitSettings.leaveAtLeast + '">');
  html += '</div>';
  html += '<p class="hint">Half-pound dishes (names with 1/2#) use the small stack. Prepaid pickups stay at the pickup store. Delivery orders are assigned to the Rim. The rest is split by the share above, then rounded so each store gets at least one stack when there are enough plates. Apply is a suggestion you confirm. It only changes the local copy in this browser.</p>';
  html += '<div class="split-actions">';
  html += '<button class="btn btn-secondary" onclick="document.getElementById(\'platedCsv\').click()">Import plated CSV</button>';
  html += '<button class="btn btn-secondary" onclick="document.getElementById(\'prepaidCsv\').click()">Import prepaid CSV</button>';
  html += '<button class="btn btn-secondary" onclick="document.getElementById(\'platedJson\').click()">Import plate-list JSON</button>';
  html += '<button class="btn btn-secondary" onclick="loadSampleWeek()">Load practice week</button>';
  html += '<button class="btn btn-secondary" onclick="proposeShareChanges()">Propose share changes</button>';
  html += '<button class="btn btn-primary" onclick="saveSplitSettings().then(function(){showToast(\'Split settings saved in this browser\')})">Save settings</button>';
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
  active.forEach(function (name) { html += splitCard(name, false); });
  html += '</div>';
  if (skipped.length) {
    html += '<details class="skip-details"><summary>Skipped (' + skipped.length + ')</summary>';
    skipped.forEach(function (name) { html += '<div class="hint" style="padding:6px 0;">' + esc(name) + '</div>'; });
    html += '</details>';
  }
  root.innerHTML = html;
  refreshSplitResults();
}

function field(label, control) {
  return '<label class="split-field"><span>' + label + '</span>' + control + '</label>';
}

function splitCard(name, skipped) {
  var mem = splitMemory[name] || {};
  return '<div class="split-card" data-dish="' + esc(name) + '">' +
    '<div class="split-card-head"><label><input type="checkbox" class="split-include" checked> Apply</label><strong>' + esc(name) + '</strong></div>' +
    '<div class="split-inputs">' +
    numField('Plated', 'plated', mem.plated) +
    numField('Pickup Colonnade', 'prepaid-c', mem.prepaidColonnade) +
    numField('Pickup Rim', 'prepaid-r', mem.prepaidRim) +
    numField('Delivery', 'delivery', mem.delivery) +
    '</div>' +
    '<div class="split-result"></div></div>';
}

function numField(label, cls, value) {
  var v = value ? String(value) : '';
  return '<label><span>' + label + '</span><input class="' + cls + '" type="number" min="0" inputmode="numeric" value="' + v + '" oninput="refreshSplitResults()"></label>';
}

function readSplitMemory() {
  document.querySelectorAll('#splitCards .split-card').forEach(function (card) {
    var name = card.dataset.dish;
    if (!name) return;
    splitMemory[name] = {
      plated: numVal(card, '.plated'),
      prepaidColonnade: numVal(card, '.prepaid-c'),
      prepaidRim: numVal(card, '.prepaid-r'),
      delivery: numVal(card, '.delivery')
    };
  });
}

function numVal(card, sel) {
  var el = card.querySelector(sel);
  return el && el.value !== '' ? (parseInt(el.value, 10) || 0) : 0;
}

function refreshSplitResults() {
  readSplitSettingsFromDom();
  readSplitMemory();
  document.querySelectorAll('#splitCards .split-card').forEach(function (card) {
    var name = card.dataset.dish;
    var mem = splitMemory[name] || {};
    var result = ZedSplit.splitDish({
      dish: name,
      plated: mem.plated || 0,
      prepaidColonnade: mem.prepaidColonnade || 0,
      prepaidRim: mem.prepaidRim || 0,
      delivery: mem.delivery || 0
    }, currentSplitConfig());
    var box = card.querySelector('.split-result');
    if (!mem.plated) {
      box.innerHTML = '<span class="hint">Enter a plated count</span>';
      return;
    }
    var warn = result.warnings.length ? '<div class="preview-short">' + esc(result.warnings.join(' · ')) + '</div>' : '';
    box.innerHTML = '<strong>Colonnade ' + result.colonnade + ' · Rim ' + result.rim + '</strong>' +
      '<div class="hint">Stack ' + result.stackSize + ' · pickup ' + result.prepaidColonnade + '/' + result.prepaidRim + ' · delivery ' + result.delivery + '</div>' + warn;
  });
}

function collectSplitResults() {
  readSplitSettingsFromDom();
  var rows = [];
  document.querySelectorAll('#splitCards .split-card').forEach(function (card) {
    var name = card.dataset.dish;
    var include = card.querySelector('.split-include').checked;
    var result = ZedSplit.splitDish({
      dish: name,
      plated: numVal(card, '.plated'),
      prepaidColonnade: numVal(card, '.prepaid-c'),
      prepaidRim: numVal(card, '.prepaid-r'),
      delivery: numVal(card, '.delivery')
    }, currentSplitConfig());
    result.include = include;
    rows.push(result);
  });
  return rows;
}

function applySplit() {
  saveSplitSettings();
  var results = collectSplitResults().filter(function (row) { return row.include && !row.skipped && row.plated > 0; });
  if (!results.length) { showToast('Enter plated counts and leave Apply checked'); return; }
  var bad = results.filter(function (row) { return row.colonnade + row.rim !== row.plated; });
  if (bad.length) { showToast('A split does not add up. Nothing was written.'); return; }
  var warnCount = results.filter(function (row) { return row.warnings.length; }).length;
  var message = 'Set case counts for ' + results.length + ' dishes? Use-by is the plate date plus each dish\'s shelf life. This replaces that use-by date at each case and leaves older dates in place.';
  if (warnCount) message += ' ' + warnCount + ' dish(es) have a warning.';
  message += ' A backup of this browser\'s data will download first. Firebase is not used.';
  if (!confirm(message)) return;
  downloadLocalBackup();
  var plateDate = document.getElementById('splitPlateDate').value || today();
  var updates = {};
  var logItems = [];
  results.forEach(function (row) {
    var useBy = ZedSplit.isoToUseByKey(ZedSplit.addDaysIso(plateDate, getShelfLife(row.dish)));
    var dk = dishKey(row.dish);
    updates[dk + '/' + useBy + '/colonnade'] = row.colonnade;
    updates[dk + '/' + useBy + '/rim'] = row.rim;
    logItems.push({ dish: dk, dishName: row.dish, useBy: useBy, colonnade: row.colonnade, rim: row.rim, plated: row.plated });
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
    showToast('Split saved locally for ' + results.length + ' dishes');
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
  Object.keys(sample).forEach(function (name) {
    splitMemory[findKnownDish(name)] = { plated: sample[name], prepaidColonnade: 0, prepaidRim: 0, delivery: 0 };
  });
  splitMemory[findKnownDish('Tex Mex Turkey Picadillo (1)')].prepaidColonnade = 8;
  splitMemory[findKnownDish('Tex Mex Turkey Picadillo (1)')].prepaidRim = 5;
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
      var days = Object.keys(data).filter(function (key) { return data[key] && data[key].dishes || (data[key] && typeof data[key] === 'object'); });
      rows = ZedSplit.platedFromProduction(data, days.length ? days : Object.keys(data));
      showToast('Imported plated counts from a file (' + rows.length + ' dishes). Firebase was not read.');
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
        prepaidColonnade: prev.prepaidColonnade || 0,
        prepaidRim: prev.prepaidRim || 0,
        delivery: prev.delivery || 0
      };
    });
    buildSplitUI(true);
  });
}

function importPrepaidFile(input) {
  readTextFile(input, function (text) {
    var totals = ZedSplit.aggregateOrders(ZedSplit.parsePrepaidCsv(text));
    totals.forEach(function (row) {
      var name = findKnownDish(row.dish);
      var prev = splitMemory[name] || { plated: 0 };
      splitMemory[name] = {
        plated: prev.plated || 0,
        prepaidColonnade: (prev.prepaidColonnade || 0) + row.prepaidColonnade,
        prepaidRim: (prev.prepaidRim || 0) + row.prepaidRim,
        delivery: (prev.delivery || 0) + row.delivery
      };
    });
    buildSplitUI(true);
    showToast('Prepaid rows added. Deliveries count toward the Rim.');
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
      var store = entry.location === 'rim' || entry.location === 'colonnade' ? entry.location : '';
      if (!store) return;
      (entry.items || []).forEach(function (item) {
        stockouts.push({ name: item.dishName || findDishName(item.dish), store: store });
      });
    });
    snaps[1].forEach(function (child) {
      var entry = child.val() || {};
      if (entry.reason !== 'orange_star' || (entry.timestamp || 0) < since) return;
      var store = entry.location === 'rim' ? 'rim' : 'colonnade';
      (entry.items || []).forEach(function (item) {
        stars.push({ name: item.dishName || findDishName(item.dish), store: store, qty: item.qty });
      });
    });
    var dishes = Object.keys(splitMemory).map(function (name) {
      return { name: name, plated: splitMemory[name].plated || 0 };
    });
    var proposals = ZedSplit.proposeShareShifts({
      colonnadeShare: splitSettings.colonnadeShare,
      stackRegular: splitSettings.stackRegular,
      stackSmall: splitSettings.stackSmall,
      smallMatchers: splitSettings.smallMatchers,
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
    box.innerHTML = '<h3>Proposed share changes</h3><p class="hint">Nothing changes until you approve a row.</p>' +
      proposals.map(function (p, idx) {
        var cur = Math.round(p.current * 100);
        var next = Math.round(p.next * 100);
        return '<div class="alert-row"><span class="dish-name">' + esc(p.dish) + '<br><span class="hint">' + esc(p.note) + ' Colonnade ' + cur + '% → ' + next + '%.</span></span>' +
          (p.direction === 'none' ? '' : '<button class="btn btn-primary" onclick="approveShare(' + idx + ')">Approve</button>') + '</div>';
      }).join('');
    window._shareProposals = proposals;
  });
}

function approveShare(idx) {
  var p = (window._shareProposals || [])[idx];
  if (!p || p.direction === 'none') return;
  splitSettings.perDish[p.dish] = p.next;
  saveSplitSettings().then(function () {
    showToast('Saved a new Colonnade share for ' + p.dish + '. Counts were not moved.');
    refreshSplitResults();
  });
}
