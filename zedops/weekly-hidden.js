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

  return {
    unescapeSection: unescapeSection,
    getItemKey: getItemKey,
    isRowHidden: isRowHidden
  };
});
