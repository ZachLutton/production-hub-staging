// Weight-check storage for the staging Production Hub.
// Uses this browser, or a named app on a new staging project.
// It never uses the default Firebase app, which is the live hub.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WeightStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var STORAGE_KEY = 'zedhub_staging_weight_v1';
  var APP_NAME = 'zedops-weight';

  function empty() {
    return { targets: {}, checks: [] };
  }

  function classifyConfig(cfg) {
    var projectId = String(cfg && cfg.projectId || '').trim();
    var databaseURL = String(cfg && cfg.databaseURL || '').trim();
    if (!projectId || !databaseURL) return { mode: 'local', reason: 'empty' };
    var blob = (projectId + ' ' + databaseURL + ' ' + String(cfg.authDomain || '')).toLowerCase();
    if (blob.indexOf('zedrics') !== -1 && blob.indexOf('production-hub') !== -1) {
      return { mode: 'local', reason: 'live-blocked' };
    }
    return { mode: 'remote', reason: 'config', projectId: projectId };
  }

  function createLocalStore(storage) {
    var bag = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    function read() {
      if (!bag) return empty();
      try {
        var parsed = JSON.parse(bag.getItem(STORAGE_KEY) || '');
        if (!parsed || typeof parsed !== 'object') return empty();
        return { targets: parsed.targets || {}, checks: Array.isArray(parsed.checks) ? parsed.checks : [] };
      } catch (err) {
        return empty();
      }
    }
    function write(data) {
      if (bag) bag.setItem(STORAGE_KEY, JSON.stringify(data));
      return data;
    }
    return {
      mode: 'local',
      load: function () { return Promise.resolve(read()); },
      save: function (data) { return Promise.resolve(write(data)); }
    };
  }

  function open(options) {
    var opts = options || {};
    var decision = classifyConfig(opts.config);
    if (decision.mode !== 'remote') {
      var local = createLocalStore(opts.storage);
      local.reason = decision.reason;
      return Promise.resolve(local);
    }
    var firebase = opts.firebase;
    if (!firebase || !firebase.initializeApp) return Promise.resolve(createLocalStore(opts.storage));
    var app = null;
    if (firebase.apps && firebase.app) {
      for (var i = 0; i < firebase.apps.length; i++) {
        if (firebase.apps[i].name === APP_NAME) app = firebase.apps[i];
      }
    }
    if (!app) app = firebase.initializeApp(opts.config, APP_NAME);
    var ref = app.database().ref('staging_weight');
    return ref.once('value').then(function (snap) {
      var current = snap.val() || empty();
      return {
        mode: 'remote',
        reason: 'config',
        projectId: decision.projectId,
        load: function () { return ref.once('value').then(function (next) { return next.val() || empty(); }); },
        save: function (data) { return ref.set(data).then(function () { return data; }); },
        _current: current
      };
    });
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    APP_NAME: APP_NAME,
    classifyConfig: classifyConfig,
    createLocalStore: createLocalStore,
    open: open
  };
});
