// Chooses the inventory database.
// An empty config stays on this browser. A filled config must be a new
// staging project. The live hub is refused without storing its id here.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedRemote = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function classifyFirebaseConfig(cfg) {
    var projectId = String(cfg && cfg.projectId || '').trim();
    var databaseURL = String(cfg && cfg.databaseURL || '').trim();
    if (!projectId || !databaseURL) return { mode: 'local', reason: 'empty', projectId: '' };
    var blob = (projectId + ' ' + databaseURL + ' ' + String(cfg.authDomain || '')).toLowerCase();
    if (blob.indexOf('zedrics') !== -1 && blob.indexOf('production-hub') !== -1) {
      return { mode: 'local', reason: 'live-project-blocked', projectId: '' };
    }
    return { mode: 'remote', reason: 'config', projectId: projectId };
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing && existing.dataset.loaded === '1') { resolve(); return; }
      var script = document.createElement('script');
      script.src = src;
      script.onload = function () { script.dataset.loaded = '1'; resolve(); };
      script.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(script);
    });
  }

  function loadFirebaseSdk() {
    var firebase = typeof window !== 'undefined' ? window.firebase : null;
    if (firebase && firebase.database) return Promise.resolve(firebase);
    var version = '10.14.1';
    var base = 'https://www.gstatic.com/firebasejs/' + version + '/';
    return loadScript(base + 'firebase-app-compat.js').then(function () {
      return loadScript(base + 'firebase-database-compat.js');
    }).then(function () { return window.firebase; });
  }

  function openDatabase(config, options) {
    var decision = classifyFirebaseConfig(config);
    var createLocal = options && options.createLocal;
    function localResult(reason) {
      var local = createLocal ? createLocal() : null;
      return {
        mode: 'local',
        reason: reason,
        projectId: '',
        db: local,
        serverValue: local && local.ServerValue ? local.ServerValue : { TIMESTAMP: { '.sv': 'timestamp' } }
      };
    }
    if (decision.mode !== 'remote') return Promise.resolve(localResult(decision.reason));
    var loader = (options && options.loadSdk) || loadFirebaseSdk;
    return loader().then(function (firebase) {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(config);
      var database = firebase.database();
      return {
        mode: 'remote',
        reason: 'config',
        projectId: decision.projectId,
        db: database,
        serverValue: firebase.database.ServerValue
      };
    }).catch(function () {
      return localResult('remote-failed');
    });
  }

  return {
    classifyFirebaseConfig: classifyFirebaseConfig,
    openDatabase: openDatabase,
    loadFirebaseSdk: loadFirebaseSdk
  };
});
