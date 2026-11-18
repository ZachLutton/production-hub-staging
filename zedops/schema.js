// Schema version lives in the data. Migrations are pure and safe to run twice.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedSchema = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var SCHEMA_VERSION = 3;

  function weekdayOf(ymd) {
    var bits = String(ymd || '').split('-').map(Number);
    if (bits.length !== 3 || !bits[0] || !bits[1] || !bits[2]) return -1;
    return new Date(Date.UTC(bits[0], bits[1] - 1, bits[2])).getUTCDay();
  }

  function addDaysYmd(ymd, days) {
    var bits = String(ymd).split('-').map(Number);
    return new Date(Date.UTC(bits[0], bits[1] - 1, bits[2] + days)).toISOString().slice(0, 10);
  }

  // Tuesday keys were the day before the cook. A Wednesday key is already the cook date.
  function cookKeyFromLegacyWeek(week) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week || ''))) return week;
    if (weekdayOf(week) !== 2) return week;
    return addDaysYmd(week, 1);
  }

  function shiftWeekMap(weeks) {
    var out = {};
    Object.keys(weeks || {}).forEach(function (week) {
      var next = cookKeyFromLegacyWeek(week);
      if (!out[next]) out[next] = {};
      var dest = out[next];
      Object.keys(weeks[week] || {}).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(dest, key)) dest[key] = weeks[week][key];
      });
    });
    return out;
  }

  function catalogApi() {
    if (typeof require === 'function') {
      try { return require('./catalog.js'); } catch (e) { /* browser or circular */ }
    }
    return typeof globalThis !== 'undefined' ? globalThis.ZedCatalog : null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function asList(value) {
    var api = catalogApi();
    if (api) return api.asList(value);
    if (!value) return [];
    if (Array.isArray(value)) return value.slice();
    return Object.keys(value).map(function (key) { return value[key]; });
  }

  function tooNew() {
    var err = new Error('This ZedOps data is newer than this page. Reload after the site is updated.');
    err.code = 'schema-too-new';
    return err;
  }

  function versionOf(data) {
    if (!data || data.schemaVersion == null) return 0;
    return Number(data.schemaVersion) || 0;
  }

  function catalogV0toV1(data) {
    var api = catalogApi();
    var source = data || {};
    var itemsIn = source.items;
    var items = {};
    var guide = [];
    var special = [];
    var vendorChecks = [];
    if (Array.isArray(itemsIn)) {
      itemsIn.forEach(function (row) {
        if (!row) return;
        var copy = clone(row);
        if (!copy.id && api) {
          var key = copy.internalKey || copy.itemNumber;
          if (key) copy.id = api.catalogId(copy.vendor || 'bek', key);
        }
        if (!copy.id) return;
        items[copy.id] = copy;
        if (copy.kind === 'special') special.push(copy.id);
        else if (copy.kind === 'vendor_check') vendorChecks.push(copy.id);
        else guide.push(copy.id);
      });
    } else if (itemsIn && typeof itemsIn === 'object') {
      Object.keys(itemsIn).forEach(function (id) { items[id] = clone(itemsIn[id]); });
    }
    var shelfIn = source.shelf && typeof source.shelf === 'object' ? source.shelf : {};
    var shelf = {
      guide: asList(shelfIn.guide),
      special: asList(shelfIn.special),
      vendorChecks: asList(shelfIn.vendorChecks)
    };
    if (!shelf.guide.length) shelf.guide = guide;
    if (!shelf.special.length) shelf.special = special;
    if (!shelf.vendorChecks.length) shelf.vendorChecks = vendorChecks;
    return { schemaVersion: 1, items: items, shelf: shelf };
  }

  function migrateCatalog(raw) {
    var data = clone(raw) || {};
    var version = versionOf(data);
    if (version > SCHEMA_VERSION) throw tooNew();
    if (version < 1) data = catalogV0toV1(data);
    else {
      data.items = data.items || {};
      data.shelf = data.shelf || {};
      data.shelf.guide = asList(data.shelf.guide);
      data.shelf.special = asList(data.shelf.special);
      data.shelf.vendorChecks = asList(data.shelf.vendorChecks);
    }
    data.schemaVersion = SCHEMA_VERSION;
    return data;
  }

  function blankLocation(id) {
    return {
      id: id,
      name: id,
      isCulinaryCenter: false,
      isProductionHub: false,
      countsWeeklyBek: false,
      legacyWeekly: false,
      monthlyLocationId: '',
      listSource: 'inventory',
      active: true
    };
  }

  function migrateLocations(raw) {
    var source = raw;
    if (source && source.locations && source.schemaVersion != null && !source.id) source = source.locations;
    var list = [];
    if (Array.isArray(source)) list = source;
    else if (source && typeof source === 'object') list = Object.keys(source).map(function (key) { return source[key]; });
    var map = {};
    list.forEach(function (row) {
      if (!row || typeof row !== 'object' || !row.id) return;
      var loc = blankLocation(String(row.id));
      loc.name = String(row.name || loc.id);
      loc.isCulinaryCenter = !!row.isCulinaryCenter;
      loc.isProductionHub = !!row.isProductionHub;
      loc.countsWeeklyBek = !!row.countsWeeklyBek;
      loc.legacyWeekly = !!row.legacyWeekly;
      loc.monthlyLocationId = row.monthlyLocationId == null ? '' : String(row.monthlyLocationId);
      loc.active = row.active === false ? false : true;
      loc.listSource = row.listSource === 'catalog' || row.listSource === 'inventory'
        ? row.listSource
        : (loc.isProductionHub ? 'catalog' : 'inventory');
      map[loc.id] = loc;
    });
    return { schemaVersion: SCHEMA_VERSION, locations: map };
  }

  // Older counts were keyed by the bare item number. Move them onto vendor__itemNumber
  // once, and leave an already-migrated key where it is.
  function migrateCounts(counts, catalog) {
    var items = (catalog && catalog.items) || {};
    var out = {};
    Object.keys(counts || {}).forEach(function (loc) {
      var weeks = counts[loc];
      if (!weeks || typeof weeks !== 'object') return;
      out[loc] = {};
      Object.keys(weeks).forEach(function (week) {
        var bag = weeks[week] || {};
        if (!out[loc][week]) out[loc][week] = {};
        Object.keys(bag).forEach(function (key) {
          var value = bag[key];
          var next = key;
          if (String(key).indexOf('__') === -1) {
            var bek = 'bek__' + key;
            if (items[bek]) {
              if (Object.prototype.hasOwnProperty.call(bag, bek)) return;
              next = bek;
            }
          }
          out[loc][week][next] = value;
        });
      });
      out[loc] = shiftWeekMap(out[loc]);
    });
    return out;
  }

  function migrateRecipeWeeks(recipe) {
    return shiftWeekMap(recipe || {});
  }

  function migrateAll(root) {
    var data = clone(root) || {};
    var version = versionOf(data);
    if (version > SCHEMA_VERSION) throw tooNew();
    if (version >= SCHEMA_VERSION) {
      data.schemaVersion = SCHEMA_VERSION;
      if (data.catalog) data.catalog = migrateCatalog(data.catalog);
      if (data.locations) data.locations = migrateLocations(data.locations);
      return data;
    }
    if (Array.isArray(data.items) && !data.catalog) {
      data.catalog = { schemaVersion: 0, items: data.items, shelf: data.shelf || null };
      delete data.items;
      delete data.shelf;
    }
    data.catalog = migrateCatalog(data.catalog || { schemaVersion: 0, items: {}, shelf: {} });
    data.locations = migrateLocations(data.locations || {});
    data.counts = migrateCounts(data.counts || {}, data.catalog);
    data.recipe = migrateRecipeWeeks(data.recipe || {});
    data.pars = data.pars && typeof data.pars === 'object' ? data.pars : {};
    data.hidden = data.hidden && typeof data.hidden === 'object' ? data.hidden : {};
    data.priceApprovals = data.priceApprovals && typeof data.priceApprovals === 'object' ? data.priceApprovals : {};
    data.schemaVersion = SCHEMA_VERSION;
    return data;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    clone: clone,
    versionOf: versionOf,
    migrateCatalog: migrateCatalog,
    migrateLocations: migrateLocations,
    migrateCounts: migrateCounts,
    migrateRecipeWeeks: migrateRecipeWeeks,
    cookKeyFromLegacyWeek: cookKeyFromLegacyWeek,
    migrateAll: migrateAll
  };
});
