// BEK weekly count: guide rows, count units, the Tuesday week, and the price gate.
// Location names are not decided here. Callers pass the store list.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedBek = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var TZ = 'America/Chicago';

  var EXTRA_SPECIALS = [
    { internalKey: 'local_salmon_4oz', name: '4 oz salmon filets', pack: '10 lb case', countUnit: 'pound', temporary: false },
    { internalKey: 'local_mahi_8oz', name: '8 oz mahi filets', pack: '10 lb case', countUnit: 'pound', temporary: true }
  ];

  var VENDOR_CHECKS = [
    { vendor: 'labelmatch', itemNumber: 'labels', name: 'Labelmatch labels', countUnit: 'each' },
    { vendor: 'cpt', itemNumber: 'containers', name: 'CPT containers', countUnit: 'each' },
    { vendor: 'airgas', itemNumber: 'ice_packs', name: 'Airgas ice packs', countUnit: 'each' },
    { vendor: 'michael_fleming', itemNumber: 'film', name: 'Michael Fleming film', countUnit: 'each' }
  ];

  function isNode() {
    return typeof module !== 'undefined' && !!module.exports && typeof require === 'function';
  }

  function deps() {
    if (isNode()) {
      return {
        catalog: require('./catalog.js'),
        schema: require('./schema.js'),
        storage: require('./storage.js'),
        locations: require('./locations.js'),
        weekly: require('./weekly-hidden.js')
      };
    }
    return {
      catalog: globalThis.ZedCatalog,
      schema: globalThis.ZedSchema,
      storage: globalThis.ZedStorage,
      locations: globalThis.ZedLocations,
      weekly: globalThis.ZedWeekly
    };
  }

  function defaultCountUnit(pack, name) {
    var text = String(pack || '');
    if (/128\s*oz/i.test(text)) return 'gallon';
    if (/#10\s*can/i.test(text)) return 'can';
    var match = text.match(/\/\s*[\d./-]*\s*([A-Za-z]+)/);
    var unit = match ? match[1].toUpperCase() : '';
    var named = {
      GAL: 'gallon', LB: 'pound', OZ: 'ounce', CT: 'each', LTR: 'liter',
      ROLL: 'roll', CS: 'case', QT: 'quart', FT: 'foot'
    };
    if (named[unit]) return named[unit];
    if (/salmon|mahi|filet/i.test(String(name || ''))) return 'pound';
    return 'each';
  }

  function guideRecord(row) {
    var catalog = deps().catalog;
    var itemNumber = catalog.itemNumberText(row.itemNumber);
    return {
      id: catalog.catalogId('bek', itemNumber),
      vendor: 'bek',
      itemNumber: itemNumber,
      internalKey: '',
      name: row.name || '',
      brand: row.brand || '',
      pack: row.pack || '',
      price: row.price == null || row.price === '' ? null : Number(row.price),
      tempZone: row.tempZone || '',
      label: row.label || '',
      guidePar: row.par == null || row.par === '' ? null : Number(row.par),
      each: !!row.each,
      weeklyCaseAverage: row.weeklyCaseAverage == null || row.weeklyCaseAverage === '' ? null : Number(row.weeklyCaseAverage),
      specialPricing: !!row.specialPricing,
      countUnit: row.countUnit || defaultCountUnit(row.pack, row.name),
      kind: 'guide',
      temporary: false,
      removed: false,
      active: true
    };
  }

  function specialRecord(row) {
    var catalog = deps().catalog;
    var internalKey = row.internalKey ? String(row.internalKey) : '';
    var itemNumber = internalKey ? '' : catalog.itemNumberText(row.itemNumber);
    return {
      id: catalog.catalogId('bek', internalKey || itemNumber),
      vendor: 'bek',
      itemNumber: itemNumber,
      internalKey: internalKey,
      name: row.name || '',
      brand: row.brand || '',
      supplier: row.supplier || '',
      pack: row.pack || '',
      price: row.price == null || row.price === '' ? null : Number(row.price),
      tempZone: '',
      label: 'Special Order',
      guidePar: row.par == null || row.par === '' ? null : Number(row.par),
      each: false,
      weeklyCaseAverage: null,
      specialPricing: false,
      countUnit: row.countUnit || defaultCountUnit(row.pack, row.name),
      kind: 'special',
      temporary: !!row.temporary,
      removed: !!row.removed,
      active: row.active === false ? false : true
    };
  }

  function vendorRecord(row) {
    var id = deps().catalog.catalogId(row.vendor, row.itemNumber);
    return {
      id: id,
      vendor: deps().catalog.vendorSlug(row.vendor),
      itemNumber: deps().catalog.itemNumberText(row.itemNumber),
      internalKey: '',
      name: row.name || '',
      brand: '',
      pack: '',
      price: null,
      tempZone: '',
      label: 'Other vendors',
      guidePar: null,
      each: false,
      weeklyCaseAverage: null,
      specialPricing: false,
      countUnit: row.countUnit || 'each',
      kind: 'vendor_check',
      temporary: false,
      removed: false,
      active: true
    };
  }

  function buildCatalog(seed) {
    var items = {};
    var guide = [];
    var special = [];
    var vendorChecks = [];
    ((seed && seed.guide) || []).forEach(function (row) {
      var rec = guideRecord(row);
      items[rec.id] = rec;
      guide.push(rec.id);
    });
    ((seed && seed.special) || []).forEach(function (row) {
      var rec = specialRecord(row);
      items[rec.id] = rec;
      special.push(rec.id);
    });
    EXTRA_SPECIALS.forEach(function (row) {
      var rec = specialRecord(row);
      items[rec.id] = rec;
      special.push(rec.id);
    });
    VENDOR_CHECKS.forEach(function (row) {
      var rec = vendorRecord(row);
      items[rec.id] = rec;
      vendorChecks.push(rec.id);
    });
    return { schemaVersion: 1, items: items, shelf: { guide: guide, special: special, vendorChecks: vendorChecks } };
  }

  function headerIndex(headers, names) {
    for (var i = 0; i < headers.length; i++) {
      var header = String(headers[i] || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      for (var n = 0; n < names.length; n++) {
        if (header === names[n] || header.indexOf(names[n]) === 0) return i;
      }
    }
    return -1;
  }

  function cell(row, index) {
    if (index < 0 || !row || row[index] == null) return '';
    return String(row[index]).trim();
  }

  function numberCell(row, index) {
    var text = cell(row, index);
    if (!text || text === '-' || text.toUpperCase() === 'N') return null;
    var number = Number(text);
    return isFinite(number) ? number : null;
  }

  function rowsFromMatrix(matrix) {
    if (!matrix || !matrix.length) throw new Error('That file is empty.');
    var headers = matrix[0];
    var labelCol = headerIndex(headers, ['label name']);
    var itemCol = headerIndex(headers, ['item #', 'item number']);
    if (itemCol < 0) throw new Error('The file needs an Item # column.');
    var kind = labelCol >= 0 ? 'guide' : 'special';
    var nameCol = headerIndex(headers, ['item name', 'name']);
    var brandCol = headerIndex(headers, ['brand']);
    var packCol = headerIndex(headers, ['pack / size', 'pack']);
    var tempCol = headerIndex(headers, ['temp zone', 'temp']);
    var priceCol = headerIndex(headers, ['price']);
    var eachCol = headerIndex(headers, ['each']);
    var parCol = headerIndex(headers, ['par']);
    var avgCol = headerIndex(headers, ['weekly case average']);
    var specialCol = headerIndex(headers, ['special pricing']);
    var supplierCol = headerIndex(headers, ['supplier']);
    var rows = [];
    for (var r = 1; r < matrix.length; r++) {
      var itemNumber = cell(matrix[r], itemCol);
      if (!itemNumber) continue;
      if (kind === 'guide') {
        rows.push({
          itemNumber: itemNumber,
          name: cell(matrix[r], nameCol),
          brand: cell(matrix[r], brandCol),
          pack: cell(matrix[r], packCol),
          tempZone: cell(matrix[r], tempCol),
          price: numberCell(matrix[r], priceCol),
          each: /^(y|yes)$/i.test(cell(matrix[r], eachCol)),
          par: numberCell(matrix[r], parCol),
          label: cell(matrix[r], labelCol),
          weeklyCaseAverage: numberCell(matrix[r], avgCol),
          specialPricing: /^(y|yes|true)$/i.test(cell(matrix[r], specialCol))
        });
      } else {
        rows.push({
          itemNumber: itemNumber,
          name: cell(matrix[r], nameCol),
          brand: cell(matrix[r], brandCol),
          supplier: cell(matrix[r], supplierCol),
          pack: cell(matrix[r], packCol)
        });
      }
    }
    if (!rows.length) throw new Error('No items were found in that file.');
    return { kind: kind, rows: rows };
  }

  function diffUpload(catalog, parsed) {
    if (parsed.kind === 'guide') {
      return deps().catalog.diffShelf(catalog, 'guide', parsed.rows.map(guideRecord), { substitutions: true });
    }
    return deps().catalog.diffShelf(catalog, 'special', parsed.rows.map(specialRecord), { keepInternal: true });
  }

  function planUpload(catalog, diff) {
    return deps().catalog.planShelfWrites(catalog, diff);
  }

  function chicagoParts(now) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
    }).formatToParts(now || new Date());
    function get(type) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
      return '';
    }
    return {
      ymd: get('year') + '-' + get('month') + '-' + get('day'),
      dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
    };
  }

  function addDays(ymd, days) {
    var bits = String(ymd || '').split('-').map(Number);
    var date = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2] + days));
    return date.toISOString().slice(0, 10);
  }

  // Weekday of a calendar date. UTC noon keeps America/Chicago dates from shifting a day.
  function weekdayOf(ymd) {
    var bits = String(ymd || '').split('-').map(Number);
    if (bits.length !== 3 || !bits[0] || !bits[1] || !bits[2]) return -1;
    return new Date(Date.UTC(bits[0], bits[1] - 1, bits[2])).getUTCDay();
  }

  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function shortDate(ymd) {
    var bits = String(ymd || '').split('-');
    if (bits.length !== 3) return '';
    return WEEKDAYS[weekdayOf(ymd)] + ' ' + Number(bits[1]) + '/' + Number(bits[2]);
  }

  // Counts are due 8 days before the cook date, the order goes in the next day, delivery is 4 days before the cook.
  function cycleForCook(cook) {
    return {
      cook: cook,
      countsDue: addDays(cook, -8),
      orderSubmit: addDays(cook, -7),
      delivery: addDays(cook, -4)
    };
  }

  function formatCycle(cook) {
    if (!cook || weekdayOf(cook) < 0) return '';
    var cycle = cycleForCook(cook);
    return 'Counts due end of ' + shortDate(cycle.countsDue) + ' · Order ' + shortDate(cycle.orderSubmit) + ' · Delivery ' + shortDate(cycle.delivery) + ' · Cook ' + shortDate(cycle.cook);
  }

  // The order cycle a calendar day belongs to. Its cook date is 8 days after that day's count Tuesday.
  function cycleCookForDay(ymd) {
    var due = addDays(ymd, 2 - weekdayOf(ymd));
    return addDays(due, 8);
  }

  // The cook date to open on. Counts stay open through the end of their Tuesday,
  // so Saturday 2026-10-31 opens cook Wednesday 2026-11-11, not the 11/4 cycle whose counts closed on 10/27.
  function openCookDate(ymd) {
    var cook = cycleCookForDay(ymd);
    var guard = 0;
    while (cycleForCook(cook).countsDue < ymd && guard < 8) {
      cook = addDays(cook, 7);
      guard++;
    }
    return cook;
  }

  // Any picked day snaps to a Wednesday cook date. A Wednesday is that cook date.
  function selectCookDate(ymd) {
    if (weekdayOf(ymd) === 3) return ymd;
    return cycleCookForDay(ymd);
  }

  // Older saves used the Tuesday before the Wednesday cook. 2026-11-03 becomes cook date 2026-11-04.
  function cookKeyFromLegacyWeek(week) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week || ''))) return week;
    if (weekdayOf(week) !== 2) return week;
    return addDays(week, 1);
  }

  function recipeCycleWarning(fileCook, cycleCook) {
    if (!fileCook || !cycleCook || fileCook === cycleCook) return '';
    return 'This file is the scaled recipe for ' + shortDate(fileCook) + '. This cycle cooks ' + shortDate(cycleCook) + '. Switch the cook date to ' + shortDate(fileCook) + ' before approving.';
  }

  // The count is due at the end of Tuesday. Monday looks ahead to that Tuesday.
  // Wednesday through Saturday still show the Tuesday that just closed.
  function countWeekTuesday(now) {
    var ymd = chicagoParts(now || new Date()).ymd;
    return addDays(ymd, 2 - weekdayOf(ymd));
  }

  function isLastMonday(now) {
    var ymd = chicagoParts(now || new Date()).ymd;
    if (weekdayOf(ymd) !== 1) return false;
    return addDays(ymd, 7).slice(0, 7) !== ymd.slice(0, 7);
  }

  function monthKey(now) {
    return chicagoParts(now || new Date()).ymd.slice(0, 7);
  }

  function need(par, onHand) {
    return Math.max(0, (Number(par) || 0) - (Number(onHand) || 0));
  }

  function formatQty(value) {
    if (value == null || value === '') return '';
    var number = Number(value);
    if (!isFinite(number)) return '';
    if (Math.abs(number - Math.round(number)) < 1e-9) return String(Math.round(number));
    return String(Math.round(number * 100) / 100);
  }

  function isShown(item) {
    return !!(item && item.active !== false && item.removed !== true);
  }

  function orderedItems(catalog, shelfKey) {
    var list = deps().catalog.asList(catalog && catalog.shelf && catalog.shelf[shelfKey]);
    return list.map(function (id) { return catalog.items[id]; }).filter(isShown);
  }

  function groupsForGuide(catalog) {
    var groups = [];
    var index = {};
    orderedItems(catalog, 'guide').forEach(function (item) {
      var label = item.label || 'Other';
      if (!Object.prototype.hasOwnProperty.call(index, label)) {
        index[label] = groups.length;
        groups.push({ label: label, items: [] });
      }
      groups[index[label]].items.push(item);
    });
    return groups;
  }

  function flattenInventory(raw) {
    var out = [];
    Object.keys(raw || {}).forEach(function (section) {
      var rows = raw[section];
      var list = Array.isArray(rows) ? rows : deps().catalog.asList(rows);
      list.forEach(function (row) { if (row && typeof row === 'object') out.push(row); });
    });
    return out;
  }

  function priceChanges(catalog, inventoryRows) {
    var byNumber = {};
    (inventoryRows || []).forEach(function (row) {
      var number = deps().catalog.itemNumberText(row && row.itemNumber);
      if (number) byNumber[number] = row;
    });
    var up = [];
    var down = [];
    var missing = [];
    orderedItems(catalog, 'guide').forEach(function (item) {
      if (!item.itemNumber) return;
      var current = byNumber[item.itemNumber];
      if (!current) { missing.push(item); return; }
      var before = deps().catalog.cents(current.price);
      var after = deps().catalog.cents(item.price);
      if (before == null || after == null || before === after) return;
      (after > before ? up : down).push({ item: item, from: current.price, to: item.price });
    });
    return { up: up, down: down, missing: missing };
  }

  function buildPriceApproval(catalog, now) {
    var when = now || new Date();
    if (!isLastMonday(when)) {
      var err = new Error('Prices are copied into the month-end count only on the last Monday, and only after you approve.');
      err.code = 'not-last-monday';
      throw err;
    }
    var prices = {};
    orderedItems(catalog, 'guide').forEach(function (item) {
      if (!item.itemNumber || item.price == null) return;
      prices[item.itemNumber] = item.price;
    });
    var parts = chicagoParts(when);
    return { schemaVersion: 1, month: parts.ymd.slice(0, 7), approvedAt: when.toISOString(), prices: prices };
  }

  function legacyOnHandByItemNumber(items, hidden, tuesdayCounts, wednesdayCounts) {
    var d = deps();
    var counts = Object.assign({}, tuesdayCounts || {}, wednesdayCounts || {});
    var out = {};
    Object.keys(items || {}).forEach(function (sectionKey) {
      var sectionName = d.weekly.unescapeSection(sectionKey);
      var rows = items[sectionKey];
      var list = Array.isArray(rows) ? rows : d.catalog.asList(rows);
      list.forEach(function (item, index) {
        if (!item) return;
        var key = d.weekly.getItemKey(sectionName, item, index);
        if (d.weekly.isRowHidden(item, hidden, key)) return;
        if (!Object.prototype.hasOwnProperty.call(counts, key)) return;
        var number = d.catalog.itemNumberText(item.itemNumber);
        if (!number) return;
        var onHand = parseFloat(counts[key]);
        if (!isFinite(onHand)) onHand = 0;
        if (!out[number]) out[number] = { onHand: 0, counted: true };
        out[number].onHand += onHand;
      });
    });
    return out;
  }

  function combineTotals(options) {
    var opts = options || {};
    var catalog = opts.catalog;
    var locations = opts.locations || [];
    var countsByLocation = opts.countsByLocation || {};
    var legacyByItemNumber = opts.legacyByItemNumber || {};
    var ids = deps().catalog.asList(catalog.shelf.guide).concat(deps().catalog.asList(catalog.shelf.special));
    var rows = [];
    ids.forEach(function (id) {
      var item = catalog.items[id];
      if (!isShown(item) || item.kind === 'vendor_check') return;
      var cells = {};
      var total = 0;
      var any = false;
      locations.forEach(function (loc) {
        if (loc.legacyWeekly) {
          var legacy = item.itemNumber ? legacyByItemNumber[item.itemNumber] : null;
          if (legacy && legacy.counted) {
            cells[loc.id] = legacy.onHand;
            total += Number(legacy.onHand) || 0;
            any = true;
          } else cells[loc.id] = null;
        } else if (loc.countsWeeklyBek) {
          var bag = countsByLocation[loc.id] || {};
          if (Object.prototype.hasOwnProperty.call(bag, id) && bag[id] != null && bag[id] !== '') {
            cells[loc.id] = Number(bag[id]);
            total += cells[loc.id];
            any = true;
          } else cells[loc.id] = null;
        }
      });
      rows.push({ id: id, item: item, cells: cells, total: any ? total : null });
    });
    return rows;
  }

  function looksLikeLegacyItemList(catalog) {
    if (!catalog || !catalog.items) return false;
    if (Array.isArray(catalog.items)) return true;
    var keys = Object.keys(catalog.items);
    return keys.length > 0 && keys.every(function (key) { return /^\d+$/.test(key); });
  }

  function appendCreated(db, shelf, key, seedCatalog, created) {
    var d = deps();
    var list = d.catalog.asList(shelf && shelf[key]);
    var have = {};
    list.forEach(function (id) { have[id] = true; });
    var n = list.length;
    var chain = Promise.resolve();
    d.catalog.asList(seedCatalog.shelf[key]).forEach(function (id) {
      if (have[id] || !created[id]) return;
      var index = n;
      n += 1;
      have[id] = true;
      chain = chain.then(function () {
        return db.ref(d.storage.PATHS.catalog + '/shelf/' + key + '/' + index).set(id);
      });
    });
    return chain;
  }

  function seedMissing(db, seedCatalog, defaults) {
    var d = deps();
    var paths = d.storage.PATHS;
    var created = {};
    return db.ref(paths.catalog + '/items').once('value').then(function (snap) {
      var existing = snap.val() || {};
      var chain = Promise.resolve();
      Object.keys(seedCatalog.items).forEach(function (id) {
        if (existing[id]) return;
        created[id] = true;
        chain = chain.then(function () {
          return db.ref(paths.catalog + '/items/' + id).transaction(function (current) {
            if (current !== null) { delete created[id]; return undefined; }
            return seedCatalog.items[id];
          });
        });
      });
      return chain.then(function () { return db.ref(paths.catalog + '/shelf').once('value'); }).then(function (shelfSnap) {
        var shelf = shelfSnap.val();
        if (!shelf || !d.catalog.asList(shelf.guide).length) {
          return db.ref(paths.catalog + '/shelf').set(seedCatalog.shelf);
        }
        return appendCreated(db, shelf, 'special', seedCatalog, created).then(function () {
          return appendCreated(db, shelf, 'vendorChecks', seedCatalog, created);
        });
      });
    }).then(function () {
      return db.ref(paths.locations).once('value');
    }).then(function (locSnap) {
      var locs = locSnap.val() || {};
      var chain = Promise.resolve();
      defaults.forEach(function (loc) {
        if (locs[loc.id]) return;
        chain = chain.then(function () {
          return db.ref(paths.locations + '/' + loc.id).transaction(function (current) {
            return current === null ? loc : undefined;
          });
        });
      });
      return chain;
    }).then(function () {
      return db.ref(paths.catalog + '/schemaVersion').once('value');
    }).then(function (ver) {
      if (ver.val()) return null;
      return db.ref(paths.catalog + '/schemaVersion').set(d.schema.SCHEMA_VERSION);
    });
  }

  function writeLocationsIfNeeded() {
    return Promise.resolve();
  }

  function prepareDatabase(db, seed) {
    var d = deps();
    var paths = d.storage.PATHS;
    return db.ref(paths.schema).once('value').then(function (schemaSnap) {
      var stored = schemaSnap.val();
      var version = stored && stored.schemaVersion ? Number(stored.schemaVersion) : 0;
      if (version > d.schema.SCHEMA_VERSION) {
        throw new Error('This ZedOps data is newer than this page. Reload after the site is updated.');
      }
      if (version >= d.schema.SCHEMA_VERSION) {
        return seedMissing(db, buildCatalog(seed), d.locations.defaultLocations()).then(function () { return []; });
      }
      return Promise.all([
        db.ref(paths.catalog).once('value'),
        db.ref(paths.locations).once('value'),
        db.ref(paths.counts).once('value'),
        db.ref(paths.recipe).once('value')
      ]).then(function (snaps) {
        var beforeCatalog = snaps[0].val();
        var beforeCounts = snaps[2].val() || {};
        var beforeRecipe = snaps[3].val() || {};
        var migrated = d.schema.migrateAll({
          schemaVersion: version,
          catalog: beforeCatalog || { schemaVersion: 0, items: {}, shelf: {} },
          locations: snaps[1].val() || {},
          counts: beforeCounts,
          recipe: beforeRecipe
        });
        var moves = [];
        Object.keys(beforeRecipe).forEach(function (week) {
          var next = cookKeyFromLegacyWeek(week);
          if (next !== week) moves.push({ kind: 'recipe', from: week, to: next });
        });
        Object.keys(beforeCounts).forEach(function (loc) {
          Object.keys(beforeCounts[loc] || {}).forEach(function (week) {
            var next = cookKeyFromLegacyWeek(week);
            if (next !== week) moves.push({ kind: 'counts for ' + loc, from: week, to: next });
          });
        });
        return d.storage.writeMigratedCounts(db, beforeCounts, migrated.counts || {}).then(function () {
          return d.storage.writeMigratedRecipe(db, beforeRecipe, migrated.recipe || {});
        }).then(function () {
          if (!looksLikeLegacyItemList(beforeCatalog)) return null;
          return rewriteLegacyCatalog(db, beforeCatalog, migrated.catalog);
        }).then(function () {
          return writeLocationsIfNeeded();
        }).then(function () {
          return seedMissing(db, buildCatalog(seed), d.locations.defaultLocations());
        }).then(function () {
          return db.ref(paths.schema).set({ schemaVersion: d.schema.SCHEMA_VERSION });
        }).then(function () { return moves; });
      });
    });
  }

  function rewriteLegacyCatalog(db, before, migrated) {
    var d = deps();
    var paths = d.storage.PATHS;
    var oldItems = before.items || {};
    var chain = Promise.resolve();
    Object.keys(migrated.items || {}).forEach(function (id) {
      chain = chain.then(function () {
        return db.ref(paths.catalog + '/items/' + id).transaction(function (current) {
          return current === null ? migrated.items[id] : undefined;
        });
      });
    });
    Object.keys(oldItems).forEach(function (key) {
      if (/^\d+$/.test(key)) {
        chain = chain.then(function () { return db.ref(paths.catalog + '/items/' + key).remove(); });
      }
    });
    return chain.then(function () {
      return db.ref(paths.catalog + '/shelf').once('value').then(function (snap) {
        if (snap.val() && d.catalog.asList(snap.val().guide).length) return null;
        return db.ref(paths.catalog + '/shelf').set(migrated.shelf);
      });
    });
  }

  function loadSeed() {
    if (isNode()) return Promise.resolve(require('./seed.json'));
    return fetch('zedops/seed.json').then(function (res) {
      if (!res.ok) throw new Error('Could not load the BEK guide.');
      return res.json();
    });
  }

  function parOf(item, pars) {
    var saved = pars && item && pars[item.id];
    if (saved && typeof saved === 'object') return { value: Number(saved.value) || 0, unit: saved.unit || item.countUnit || '' };
    if (typeof saved === 'number') return { value: saved, unit: item.countUnit || '' };
    return { value: item && item.guidePar != null ? Number(item.guidePar) || 0 : 0, unit: (item && item.countUnit) || '' };
  }

  return {
    EXTRA_SPECIALS: EXTRA_SPECIALS,
    VENDOR_CHECKS: VENDOR_CHECKS,
    defaultCountUnit: defaultCountUnit,
    guideRecord: guideRecord,
    specialRecord: specialRecord,
    vendorRecord: vendorRecord,
    buildCatalog: buildCatalog,
    rowsFromMatrix: rowsFromMatrix,
    diffUpload: diffUpload,
    planUpload: planUpload,
    chicagoParts: chicagoParts,
    addDays: addDays,
    weekdayOf: weekdayOf,
    shortDate: shortDate,
    cycleForCook: cycleForCook,
    formatCycle: formatCycle,
    cycleCookForDay: cycleCookForDay,
    openCookDate: openCookDate,
    selectCookDate: selectCookDate,
    cookKeyFromLegacyWeek: cookKeyFromLegacyWeek,
    recipeCycleWarning: recipeCycleWarning,
    countWeekTuesday: countWeekTuesday,
    isLastMonday: isLastMonday,
    monthKey: monthKey,
    need: need,
    formatQty: formatQty,
    isShown: isShown,
    orderedItems: orderedItems,
    groupsForGuide: groupsForGuide,
    flattenInventory: flattenInventory,
    priceChanges: priceChanges,
    buildPriceApproval: buildPriceApproval,
    legacyOnHandByItemNumber: legacyOnHandByItemNumber,
    combineTotals: combineTotals,
    prepareDatabase: prepareDatabase,
    loadSeed: loadSeed,
    parOf: parOf
  };
});
