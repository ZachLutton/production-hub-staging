// Local stand-in for the inventory Realtime Database refs.
// staging inventory.html points at the live project zedrics-production-hub,
// so this branch never loads the Firebase SDK and never reads or writes it.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedLocal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var TIMESTAMP = { '.sv': 'timestamp' };

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function applySentinels(value, now) {
    if (value && typeof value === 'object' && value['.sv'] === 'timestamp') return now;
    if (Array.isArray(value)) return value.map(function (item) { return applySentinels(item, now); });
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (key) { out[key] = applySentinels(value[key], now); });
      return out;
    }
    return value;
  }

  function partsOf(path) {
    return String(path || '').split('/').filter(Boolean);
  }

  function Snapshot(value, key) {
    this.key = key == null ? null : key;
    this._value = value;
  }
  Snapshot.prototype.val = function () { return clone(this._value); };
  Snapshot.prototype.forEach = function (cb) {
    var value = this._value;
    if (!value || typeof value !== 'object') return false;
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) cb(new Snapshot(value[keys[i]], keys[i]));
    return false;
  };

  function createInventoryDb(options) {
    var opts = options || {};
    var storage = opts.storage || null;
    var storageKey = opts.storageKey || 'zedops_staging_inv_local_v1';
    var data = {};
    if (storage) {
      try { data = JSON.parse(storage.getItem(storageKey) || '{}') || {}; } catch (e) { data = {}; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    }
    var listeners = [];
    var clock = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };

    function persist() {
      if (storage) storage.setItem(storageKey, JSON.stringify(data));
    }

    function parentPath(path) {
      var parts = partsOf(path);
      parts.pop();
      return parts.join('/');
    }

    function read(path) {
      var cur = data;
      var parts = partsOf(path);
      for (var i = 0; i < parts.length; i++) {
        if (cur == null || typeof cur !== 'object') return null;
        cur = cur[parts[i]];
      }
      return cur == null ? null : cur;
    }

    function write(path, value) {
      var parts = partsOf(path);
      if (!parts.length) {
        data = value && typeof value === 'object' ? value : {};
        return;
      }
      var cur = data;
      for (var i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      var leaf = parts[parts.length - 1];
      if (value == null) delete cur[leaf];
      else cur[leaf] = value;
    }

    function notify(path) {
      var targets = {};
      var cursor = path || '';
      targets[cursor] = true;
      while (cursor) {
        cursor = parentPath(cursor);
        targets[cursor] = true;
      }
      listeners.slice().forEach(function (listener) {
        if (!targets[listener.path]) return;
        listener.cb(new Snapshot(read(listener.path), null));
      });
    }

    function ref(path) {
      var clean = partsOf(path).join('/');
      var api = {
        path: clean,
        once: function () {
          if (clean === '.info/connected') return Promise.resolve(new Snapshot(true, null));
          return Promise.resolve(new Snapshot(read(clean), null));
        },
        on: function (_event, cb) {
          if (clean === '.info/connected') {
            cb(new Snapshot(true, null));
            return cb;
          }
          listeners.push({ path: clean, cb: cb });
          cb(new Snapshot(read(clean), null));
          return cb;
        },
        off: function () {},
        set: function (value) {
          var stored = applySentinels(clone(value), clock());
          write(clean, stored);
          persist();
          notify(clean);
          return Promise.resolve();
        },
        update: function (map) {
          var now = clock();
          Object.keys(map || {}).forEach(function (key) {
            var next = applySentinels(clone(map[key]), now);
            var full = clean ? clean + '/' + key : key;
            write(full, next);
          });
          persist();
          notify(clean);
          return Promise.resolve();
        },
        push: function (value) {
          var now = clock();
          var id = 'L' + now.toString(36) + Math.random().toString(36).slice(2, 8);
          var stored = applySentinels(clone(value), now);
          var full = clean ? clean + '/' + id : id;
          write(full, stored);
          persist();
          notify(clean);
          var result = Promise.resolve({ key: id });
          result.key = id;
          return result;
        },
        child: function (childPath) {
          var next = clean ? clean + '/' + partsOf(childPath).join('/') : partsOf(childPath).join('/');
          return ref(next);
        },
        transaction: function (fn) {
          var current = clone(read(clean));
          var next = fn(current);
          if (next === undefined) return Promise.resolve({ committed: false });
          write(clean, applySentinels(clone(next), clock()));
          persist();
          notify(clean);
          return Promise.resolve({ committed: true });
        },
        orderByChild: function (field) {
          return {
            limitToLast: function (limit) { return query(field, limit); },
            once: function () { return query(field, Infinity).once(); }
          };
        }
      };

      function query(field, limit) {
        return {
          once: function () {
            var node = read(clean);
            var rows = [];
            if (node && typeof node === 'object') {
              Object.keys(node).forEach(function (key) {
                var row = node[key];
                rows.push({ key: key, value: row, sort: row && typeof row === 'object' ? row[field] : null });
              });
            }
            rows.sort(function (a, b) {
              var av = a.sort == null ? 0 : a.sort;
              var bv = b.sort == null ? 0 : b.sort;
              if (av < bv) return -1;
              if (av > bv) return 1;
              return a.key < b.key ? -1 : 1;
            });
            if (isFinite(limit)) rows = rows.slice(Math.max(0, rows.length - limit));
            var ordered = {};
            rows.forEach(function (row) { ordered[row.key] = row.value; });
            return Promise.resolve(new Snapshot(ordered, null));
          }
        };
      }

      return api;
    }

    return {
      ref: ref,
      ServerValue: { TIMESTAMP: TIMESTAMP },
      exportAll: function () { return clone(data); },
      importAll: function (next) {
        data = next && typeof next === 'object' ? clone(next) : {};
        persist();
        notify('');
        return Promise.resolve();
      },
      reset: function () {
        data = {};
        persist();
        notify('');
        return Promise.resolve();
      }
    };
  }

  return { createInventoryDb: createInventoryDb, TIMESTAMP: TIMESTAMP };
});
