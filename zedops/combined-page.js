// Read-only Rim + counting stores, totaled by BEK item number. Nothing on this page is saved.
(function () {
  var boot = ZedBoot.start({ storageKey: 'zedops_staging_bek_combined_local_v1' });
  if (boot.mode === 'blocked') {
    throw new Error('Refusing to start. firebase-config.js points at the live Production Hub.');
  }
  var db = boot.db;
  var state = { catalog: null, locations: [], rows: [], weekKey: '' };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
    state.weekKey = ZedBek.countWeekTuesday(new Date());
    document.getElementById('weekSelect').value = state.weekKey;
    document.getElementById('dueLine').textContent = 'Use this to place the weekly BEK order. Counts are due by the end of Tuesday ' + state.weekKey + '.';
    load().catch(function (err) {
      console.error(err);
      document.getElementById('order-container').textContent = (err && err.message) || 'Could not load totals.';
    });
  }

  function load() {
    return ZedBek.loadSeed().then(function (seed) {
      return ZedBek.prepareDatabase(db, seed);
    }).then(function () {
      return Promise.all([
        db.ref(ZedStorage.PATHS.catalog).once('value'),
        db.ref(ZedStorage.PATHS.locations).once('value')
      ]);
    }).then(function (snaps) {
      var raw = snaps[0].val() || {};
      state.catalog = ZedSchema.migrateCatalog({
        schemaVersion: raw.schemaVersion || 1,
        items: raw.items || {},
        shelf: raw.shelf || {}
      });
      state.locations = ZedLocations.countingLocations(snaps[1].val() || {});
      return loadCounts();
    }).then(render);
  }

  function loadCounts() {
    var countsByLocation = {};
    var legacy = {};
    var chain = Promise.resolve();
    state.locations.forEach(function (loc) {
      if (loc.countsWeeklyBek) {
        chain = chain.then(function () {
          return db.ref(ZedStorage.PATHS.counts + '/' + loc.id + '/' + state.weekKey).once('value').then(function (snap) {
            countsByLocation[loc.id] = snap.val() || {};
          });
        });
      }
      if (loc.legacyWeekly) {
        var wed = ZedBek.addDays(state.weekKey, 1);
        var itemsPath = 'staging_inventory/' + (loc.monthlyLocationId || loc.id) + '/items';
        var base = 'staging_weekly_orders/' + loc.id;
        chain = chain.then(function () {
          return Promise.all([
            db.ref(itemsPath).once('value'),
            db.ref(base + '/hiddenFromWeekly').once('value'),
            db.ref(base + '/' + state.weekKey).once('value'),
            db.ref(base + '/' + wed).once('value')
          ]).then(function (snaps) {
            var found = ZedBek.legacyOnHandByItemNumber(snaps[0].val() || {}, snaps[1].val() || {}, snaps[2].val() || {}, snaps[3].val() || {});
            Object.keys(found).forEach(function (number) {
              if (!legacy[number]) legacy[number] = { onHand: 0, counted: true };
              legacy[number].onHand += found[number].onHand;
            });
          }).catch(function () { /* legacy path may be empty in this browser */ });
        });
      }
    });
    return chain.then(function () {
      state.rows = ZedBek.combineTotals({
        catalog: state.catalog,
        locations: state.locations,
        countsByLocation: countsByLocation,
        legacyByItemNumber: legacy
      });
      state.countsByLocation = countsByLocation;
    });
  }

  function cellText(value, unit) {
    if (value == null) return '—';
    return ZedBek.formatQty(value) + (unit ? ' ' + unit : '');
  }

  function render() {
    var cols = state.locations.map(function (loc) { return '<th>' + esc(loc.name) + '</th>'; }).join('');
    var body = state.rows.map(function (row) {
      var item = row.item;
      var number = item.itemNumber || 'no BEK #';
      var temp = item.temporary ? ' <span class="temp-badge">TEMPORARY</span>' : '';
      var cells = state.locations.map(function (loc) {
        return '<td>' + esc(cellText(row.cells[loc.id], item.countUnit)) + '</td>';
      }).join('');
      return '<tr><td class="item-num">' + esc(number) + '</td><td><div class="item-name">' + esc(item.name) + temp +
        '</div><div class="item-brand">' + esc(item.pack || '') + '</div></td>' + cells +
        '<td class="need-cell"><strong>' + esc(cellText(row.total, item.countUnit)) + '</strong></td></tr>';
    }).join('');
    document.getElementById('order-container').innerHTML = '<table class="order-table"><thead><tr><th>Item #</th><th>Name</th>' +
      cols + '<th>Total on hand</th></tr></thead><tbody>' + body + '</tbody></table>';
    document.getElementById('dueLine').textContent = 'Use this to place the weekly BEK order. Counts are due by the end of Tuesday ' + state.weekKey + '. A dash means that store has not counted the item.';
  }

  function download() {
    var lines = ['Week of Tuesday ' + state.weekKey, 'Due end of day Tuesday.', 'A blank store has not counted that item.', ''];
    state.rows.forEach(function (row) {
      var item = row.item;
      var parts = state.locations.map(function (loc) {
        return loc.name + ' ' + cellText(row.cells[loc.id], item.countUnit);
      });
      lines.push((item.itemNumber || 'no BEK #') + ' ' + item.name + (item.temporary ? ' [TEMPORARY]' : '') +
        ' | ' + parts.join(' | ') + ' | total ' + cellText(row.total, item.countUnit));
    });
    ZedPdf.downloadPdf('bek-order-totals-' + state.weekKey + '.pdf', ZedPdf.buildPdf({
      title: 'Weekly BEK order — on hand totals',
      lines: lines
    }));
  }

  document.getElementById('weekSelect').addEventListener('change', function () {
    state.weekKey = this.value || ZedBek.countWeekTuesday(new Date());
    loadCounts().then(render).catch(function (err) { alert(err.message || err); });
  });
  document.getElementById('pdfTotals').addEventListener('click', download);

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
