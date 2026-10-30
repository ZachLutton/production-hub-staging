// Shared item catalog. An item's identity is vendor + item number.
// Shelf order is a separate list, so reordering a guide does not move saved counts.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedCatalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // BEK is first. Later vendors use the same id shape: vendor__itemNumber.
  var VENDORS = [
    { id: 'bek', name: 'BEK' },
    { id: 'labelmatch', name: 'Labelmatch' },
    { id: 'cpt', name: 'CPT' },
    { id: 'airgas', name: 'Airgas' },
    { id: 'michael_fleming', name: 'Michael Fleming' }
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function asList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(function (item) { return item != null && item !== ''; });
    return Object.keys(value).sort(function (a, b) {
      var na = Number(a);
      var nb = Number(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a < b ? -1 : (a > b ? 1 : 0);
    }).map(function (key) { return value[key]; }).filter(function (item) { return item != null && item !== ''; });
  }

  function vendorSlug(vendor) {
    var slug = String(vendor || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return slug || 'vendor';
  }

  // Item numbers stay text. Never pass them through Number(): 028201 would become 28201.
  function itemNumberText(value) {
    if (value == null) return '';
    var text = String(value).trim();
    if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, '');
    return text;
  }

  function sameNumber(a, b) {
    var left = itemNumberText(a);
    var right = itemNumberText(b);
    if (!left || !right) return false;
    if (left === right) return true;
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) return left.replace(/^0+/, '') === right.replace(/^0+/, '');
    return false;
  }

  function catalogId(vendor, itemNumber) {
    var number = itemNumberText(itemNumber);
    if (!number) throw new Error('An item needs a vendor item number or a stable internal key.');
    var safe = number.replace(/[.#$/\[\]]/g, '_').replace(/\s+/g, '_');
    var id = vendorSlug(vendor) + '__' + safe;
    if (id.length > 120) id = id.slice(0, 120);
    return id;
  }

  function emptyCatalog() {
    return { schemaVersion: 1, items: {}, shelf: { guide: [], special: [], vendorChecks: [] } };
  }

  function cents(value) {
    if (value == null || value === '') return null;
    var number = Number(value);
    if (!isFinite(number)) return null;
    return Math.round(number * 100);
  }

  function findByNumber(rows, number) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && sameNumber(rows[i].itemNumber, number)) return rows[i];
    }
    return null;
  }

  function mentionedItems(text) {
    var found = [];
    var match;
    var re = /item\s+([0-9]+)/ig;
    var source = String(text || '');
    while ((match = re.exec(source))) found.push(match[1]);
    return found;
  }

  // Compare one shelf (the guide, or the special list) with the newly parsed rows.
  // Substitutions come from notes such as "replacing item 747050".
  function diffShelf(catalog, shelfKey, nextRecords, options) {
    var opts = options || {};
    var current = catalog || emptyCatalog();
    var items = current.items || {};
    var shelf = asList(current.shelf && current.shelf[shelfKey]);
    var next = (nextRecords || []).slice();
    if (opts.keepInternal) {
      shelf.forEach(function (id) {
        var item = items[id];
        if (item && item.internalKey && !next.some(function (row) { return row.id === id; })) next.push(item);
      });
    }
    var prevIndex = {};
    shelf.forEach(function (id, index) { prevIndex[id] = index; });
    var nextIndex = {};
    next.forEach(function (row, index) { nextIndex[row.id] = index; });

    var added = [];
    var dropped = [];
    var moved = [];
    var priceUp = [];
    var priceDown = [];
    next.forEach(function (row) {
      var prev = items[row.id];
      var onShelf = Object.prototype.hasOwnProperty.call(prevIndex, row.id);
      if (!prev || !onShelf) {
        added.push(row);
        return;
      }
      if (prevIndex[row.id] !== nextIndex[row.id] || String(prev.label || '') !== String(row.label || '')) {
        moved.push({
          id: row.id,
          name: row.name,
          itemNumber: row.itemNumber || '',
          fromLabel: prev.label || '',
          toLabel: row.label || '',
          fromIndex: prevIndex[row.id],
          toIndex: nextIndex[row.id]
        });
      }
      var before = cents(prev.price);
      var after = cents(row.price);
      if (before != null && after != null && after > before) {
        priceUp.push({ id: row.id, name: row.name, itemNumber: row.itemNumber || '', from: prev.price, to: row.price });
      } else if (before != null && after != null && after < before) {
        priceDown.push({ id: row.id, name: row.name, itemNumber: row.itemNumber || '', from: prev.price, to: row.price });
      }
    });
    shelf.forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(nextIndex, id)) dropped.push(items[id] || { id: id, name: id, itemNumber: '' });
    });

    var substitutions = [];
    var paired = {};
    if (opts.substitutions) {
      next.forEach(function (row) {
        mentionedItems(row.tempZone).forEach(function (number) {
          var old = findByNumber(dropped, number);
          if (old && !paired[old.id]) {
            substitutions.push({ from: old, to: row, note: row.tempZone || '' });
            paired[old.id] = true;
            paired[row.id] = true;
          }
        });
      });
      dropped.forEach(function (row) {
        mentionedItems(row.tempZone).forEach(function (number) {
          var incoming = findByNumber(added, number);
          if (incoming && !paired[row.id]) {
            substitutions.push({ from: row, to: incoming, note: row.tempZone || '' });
            paired[row.id] = true;
            paired[incoming.id] = true;
          }
        });
      });
      added = added.filter(function (row) { return !paired[row.id]; });
      dropped = dropped.filter(function (row) { return !paired[row.id]; });
    }

    var empty = !added.length && !dropped.length && !moved.length && !priceUp.length && !priceDown.length && !substitutions.length;
    return {
      shelfKey: shelfKey,
      next: next,
      added: added,
      dropped: dropped,
      moved: moved,
      priceUp: priceUp,
      priceDown: priceDown,
      substitutions: substitutions,
      empty: empty
    };
  }

  var ITEM_FIELDS = ['name', 'brand', 'pack', 'price', 'tempZone', 'label', 'guidePar', 'each', 'weeklyCaseAverage', 'specialPricing', 'itemNumber', 'vendor', 'kind', 'supplier'];

  // Writes touch one item, or the shelf-order list. Never counts, and never the whole catalog.
  function planShelfWrites(catalog, diff) {
    var current = catalog || emptyCatalog();
    var items = current.items || {};
    var writes = [];
    var seen = {};
    diff.next.forEach(function (row) {
      seen[row.id] = true;
      var prev = items[row.id];
      if (!prev) {
        writes.push({ op: 'set', path: 'staging_zedops_catalog/items/' + row.id, value: clone(row) });
        return;
      }
      var fields = {};
      ITEM_FIELDS.forEach(function (field) {
        if (JSON.stringify(prev[field] == null ? null : prev[field]) !== JSON.stringify(row[field] == null ? null : row[field])) {
          fields[field] = row[field] == null ? null : row[field];
        }
      });
      if (prev.active === false) fields.active = true;
      var sub = (diff.substitutions || []).filter(function (entry) { return entry.to && entry.to.id === row.id; })[0];
      if (sub && sub.from && sub.from.itemNumber) fields.replaces = String(sub.from.itemNumber);
      if (Object.keys(fields).length) {
        writes.push({ op: 'update', path: 'staging_zedops_catalog/items/' + row.id, value: fields });
      }
    });
    asList(current.shelf && current.shelf[diff.shelfKey]).forEach(function (id) {
      if (!seen[id]) writes.push({ op: 'update', path: 'staging_zedops_catalog/items/' + id, value: { active: false } });
    });
    writes.push({
      op: 'set',
      path: 'staging_zedops_catalog/shelf/' + diff.shelfKey,
      value: diff.next.map(function (row) { return row.id; })
    });
    writes.forEach(function (write) {
      if (write.path.indexOf('staging_zedops_counts') === 0) throw new Error('A guide change must not write counts.');
      if (write.path === 'staging_zedops_catalog') throw new Error('A guide change must not replace the catalog.');
      if (write.op === 'update' && write.value && Object.prototype.hasOwnProperty.call(write.value, 'countUnit')) {
        throw new Error('A guide change must not reset a count unit someone edited.');
      }
    });
    return writes;
  }

  return {
    VENDORS: VENDORS,
    clone: clone,
    asList: asList,
    vendorSlug: vendorSlug,
    itemNumberText: itemNumberText,
    sameNumber: sameNumber,
    catalogId: catalogId,
    emptyCatalog: emptyCatalog,
    cents: cents,
    diffShelf: diffShelf,
    planShelfWrites: planShelfWrites
  };
});
