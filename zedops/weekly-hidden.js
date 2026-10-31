// Shared key for the existing Rim weekly page.
// The monthly count hides a row with X by setting hidden:true on that item.
// The weekly page used to look only at its own hidden list, so those rows stayed visible.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedWeekly = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function unescapeSection(key) {
    return String(key || '').replace(/__SLASH__/g, '/').replace(/__DOT__/g, '.')
      .replace(/__HASH__/g, '#').replace(/__DOLLAR__/g, '$')
      .replace(/__LBRACK__/g, '[').replace(/__RBRACK__/g, ']');
  }

  function getItemKey(sectionName, item, idx) {
    var sectionId = String(sectionName || '').replace(/[^a-zA-Z0-9]/g, '_');
    var raw = (item && (item.itemNumber || item.name)) || 'item';
    var sanitized = String(raw).replace(/[.#$/\[\]]/g, '_').replace(/\s+/g, '_').substring(0, 60);
    return 'i_' + sectionId + '_' + sanitized + '_' + idx;
  }

  function isRowHidden(item, hiddenMap, key) {
    if (item && item.hidden === true) return true;
    return !!(hiddenMap && key && hiddenMap[key] === true);
  }

  // Firebase sometimes hands back a list as {"0": item, "1": item} instead of an array.
  function itemList(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    var keys = Object.keys(value);
    if (!keys.length || !keys.every(function (key) { return /^\d+$/.test(key); })) return [];
    return keys.sort(function (a, b) { return Number(a) - Number(b); }).map(function (key) { return value[key]; });
  }

  function itemsNodeEmpty(value) {
    return value == null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
  }

  function sectionsFromSnapshot(raw) {
    var out = {};
    Object.keys(raw || {}).forEach(function (key) {
      out[unescapeSection(key)] = itemList(raw[key]);
    });
    return out;
  }

  return {
    unescapeSection: unescapeSection,
    getItemKey: getItemKey,
    isRowHidden: isRowHidden,
    itemList: itemList,
    itemsNodeEmpty: itemsNodeEmpty,
    sectionsFromSnapshot: sectionsFromSnapshot
  };
});
