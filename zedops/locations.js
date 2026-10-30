// Store list for ZedOps. Any store can be the culinary center, the production hub, both, or neither.
// Names in DEFAULT_LOCATIONS are the current stores. The functions do not branch on those names.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedLocations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var DEFAULT_LOCATIONS = [
    {
      id: 'colonnade',
      name: 'Colonnade',
      isCulinaryCenter: true,
      isProductionHub: true,
      countsWeeklyBek: true,
      legacyWeekly: false,
      monthlyLocationId: 'main',
      active: true
    },
    {
      id: 'rim',
      name: 'The Rim',
      isCulinaryCenter: false,
      isProductionHub: false,
      countsWeeklyBek: false,
      legacyWeekly: true,
      monthlyLocationId: 'rim',
      active: true
    }
  ];

  var ROLES = ['isCulinaryCenter', 'isProductionHub', 'countsWeeklyBek', 'legacyWeekly'];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultLocations() {
    return clone(DEFAULT_LOCATIONS);
  }

  function slugId(name) {
    var id = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return id || 'store';
  }

  function locationMap(doc) {
    if (!doc) return {};
    if (doc.locations && typeof doc.locations === 'object' && !doc.id) return doc.locations;
    return doc;
  }

  function listLocations(doc) {
    var map = locationMap(doc);
    return Object.keys(map).map(function (key) { return map[key]; }).filter(function (loc) {
      return loc && loc.id && loc.active !== false;
    }).sort(function (a, b) {
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
  }

  function uniqueId(doc, name) {
    var map = locationMap(doc);
    var base = slugId(name);
    if (!map[base]) return base;
    var n = 2;
    while (map[base + '-' + n]) n += 1;
    return base + '-' + n;
  }

  function normalizeLocation(input) {
    var loc = input || {};
    var id = slugId(loc.id || loc.name);
    return {
      id: id,
      name: String(loc.name || id),
      isCulinaryCenter: !!loc.isCulinaryCenter,
      isProductionHub: !!loc.isProductionHub,
      countsWeeklyBek: !!loc.countsWeeklyBek,
      legacyWeekly: !!loc.legacyWeekly,
      monthlyLocationId: loc.monthlyLocationId == null ? '' : String(loc.monthlyLocationId),
      active: loc.active === false ? false : true
    };
  }

  function withRole(doc, id, role, on) {
    if (ROLES.indexOf(role) === -1) throw new Error('Unknown store setting: ' + role);
    var map = clone(locationMap(doc));
    if (!map[id]) throw new Error('No store with that id.');
    map[id] = normalizeLocation(map[id]);
    map[id][role] = !!on;
    return { schemaVersion: 1, locations: map };
  }

  function addLocation(doc, draft) {
    var map = clone(locationMap(doc));
    var loc = normalizeLocation(draft || {});
    loc.id = uniqueId({ locations: map }, loc.name);
    if (!draft || !draft.monthlyLocationId) loc.monthlyLocationId = '';
    map[loc.id] = loc;
    return { schemaVersion: 1, locations: map, added: loc };
  }

  function countingLocations(doc) {
    return listLocations(doc).filter(function (loc) { return loc.countsWeeklyBek || loc.legacyWeekly; });
  }

  function roleLabel(loc) {
    var parts = [];
    if (loc && loc.isCulinaryCenter) parts.push('Culinary center');
    if (loc && loc.isProductionHub) parts.push('Production hub');
    return parts.join(' · ');
  }

  return {
    DEFAULT_LOCATIONS: DEFAULT_LOCATIONS,
    ROLES: ROLES,
    defaultLocations: defaultLocations,
    slugId: slugId,
    listLocations: listLocations,
    uniqueId: uniqueId,
    normalizeLocation: normalizeLocation,
    withRole: withRole,
    addLocation: addLocation,
    countingLocations: countingLocations,
    roleLabel: roleLabel
  };
});
