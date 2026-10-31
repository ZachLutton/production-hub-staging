// Weight-check storage for the staging Production Hub.
// Remote saves use the page's default Firebase app, which is the app
// HubAuth signs in. A second app would not see that user, and the locked
// staging rules would deny it. The live project is refused.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WeightStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var STORAGE_KEY = 'zedhub_staging_weight_v1';

  function empty() {
    return { targets: {}, checks: [] };
  }

  function classifyConfig(cfg) {
    var projectId = String(cfg && cfg.projectId || '').trim();
    var databaseURL = String(cfg && cfg.databaseURL || '').trim();
    var blob = (projectId + ' ' + databaseURL + ' ' + String(cfg && cfg.authDomain || '') + ' ' + String(cfg && cfg.storageBucket || '')).toLowerCase();
    if (blob.indexOf('zedrics') !== -1 && blob.indexOf('production-hub') !== -1) {
      return { mode: 'blocked', reason: 'live-blocked' };
    }
    if (!projectId || !databaseURL) return { mode: 'local', reason: 'empty' };
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
    if (decision.mode === 'blocked') {
      return Promise.resolve({
        mode: 'blocked',
        reason: decision.reason,
        load: function () { return Promise.reject(new Error('live project blocked')); },
        save: function () { return Promise.reject(new Error('live project blocked')); }
      });
    }
    if (decision.mode !== 'remote') {
      var local = createLocalStore(opts.storage);
      local.reason = decision.reason;
      return Promise.resolve(local);
    }
    var firebase = opts.firebase;
    if (!firebase || !firebase.initializeApp) return Promise.resolve(createLocalStore(opts.storage));
    var app;
    var ref = null;
    try {
      app = pageApp(firebase, opts.config);
    } catch (err) {
      return Promise.reject(err);
    }
    return whenAuthenticated(app, firebase).then(function () {
      ref = databaseFor(app, firebase).ref('staging_weight');
      return ref.once('value');
    }).then(function (snap) {
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

  // The default app is the one HubAuth signs in. A named app has its own auth.
  function pageApp(firebase, config) {
    var app = findDefaultApp(firebase);
    if (!app) return firebase.initializeApp(config);
    var existingId = app.options && app.options.projectId ? String(app.options.projectId).trim() : '';
    var wanted = config && config.projectId ? String(config.projectId).trim() : '';
    if (existingId && wanted && existingId !== wanted) {
      var err = new Error('Weight checks use the page Firebase app.');
      err.code = 'weight/app-mismatch';
      throw err;
    }
    return app;
  }

  function findDefaultApp(firebase) {
    var apps = firebase && firebase.apps;
    if (apps && apps.length) {
      for (var i = 0; i < apps.length; i++) {
        var candidate = apps[i];
        if (candidate && (!candidate.name || candidate.name === '[DEFAULT]')) return candidate;
      }
    }
    if (firebase && typeof firebase.app === 'function') {
      try { return firebase.app(); } catch (e) { return null; }
    }
    return null;
  }

  function databaseFor(app, firebase) {
    if (app && typeof app.database === 'function') return app.database();
    return firebase.database();
  }

  // When the page loaded Auth, wait until that user exists. A signed-out
  // read is denied once the staging rules are locked. Mocks with no Auth
  // (local tests) skip this and use the database directly.
  function whenAuthenticated(app, firebase) {
    var auth = null;
    try {
      if (app && typeof app.auth === 'function') auth = app.auth();
      else if (firebase && typeof firebase.auth === 'function') auth = firebase.auth();
    } catch (e) {
      auth = null;
    }
    if (!auth || typeof auth.onAuthStateChanged !== 'function') return Promise.resolve();
    if (auth.currentUser) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var settled = false;
      var unsub = auth.onAuthStateChanged(function (user) {
        if (settled) return;
        settled = true;
        Promise.resolve().then(function () { if (typeof unsub === 'function') unsub(); });
        if (user) resolve();
        else {
          var err = new Error('Sign in required before weight checks');
          err.code = 'weight/signed-out';
          reject(err);
        }
      });
    });
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    classifyConfig: classifyConfig,
    createLocalStore: createLocalStore,
    open: open
  };
});
