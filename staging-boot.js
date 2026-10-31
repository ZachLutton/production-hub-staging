// Shared startup for the staging site.
// Reads window.ZEDOPS_FIREBASE_CONFIG (firebase-config.js).
// The live Production Hub project is refused. An empty config stays in this browser.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedBoot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var LIVE_ID = ['zedrics', 'production-hub'].join('-');
  var LOCAL_BANNER = 'BROWSER ONLY — firebase-config.js is empty. Changes stay in this browser. The live Production Hub is not connected. Paste the ZedOps Staging web config to share data across devices.';

  function classify(cfg) {
    var projectId = String(cfg && cfg.projectId || '').trim();
    var databaseURL = String(cfg && cfg.databaseURL || '').trim();
    var authDomain = String(cfg && cfg.authDomain || '').trim();
    var storageBucket = String(cfg && cfg.storageBucket || '').trim();
    var blob = (projectId + ' ' + databaseURL + ' ' + authDomain + ' ' + storageBucket).toLowerCase();
    if (blob.indexOf(LIVE_ID) !== -1) {
      return { mode: 'blocked', reason: 'live-project-blocked', projectId: '' };
    }
    if (!projectId || !databaseURL) return { mode: 'local', reason: 'empty', projectId: '' };
    return { mode: 'remote', reason: 'config', projectId: projectId };
  }

  function showBlocked() {
    if (typeof document === 'undefined') return;
    function paint() {
      if (!document.body || document.getElementById('staging-blocked')) return;
      var el = document.createElement('div');
      el.id = 'staging-blocked';
      el.setAttribute('role', 'alert');
      el.style.cssText = 'position:fixed;inset:0;z-index:100001;background:#3e2723;color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
      el.innerHTML = '<div style="max-width:560px"><h1 style="font-size:28px;margin:0 0 12px">Staging will not start</h1><p style="font-size:18px;line-height:1.45;margin:0">firebase-config.js points at the live Production Hub (' + LIVE_ID + '). This site will not connect to it. Replace that config with the ZedOps Staging project, or clear every value to work in this browser only.</p></div>';
      document.body.appendChild(el);
    }
    if (document.body) paint();
    else document.addEventListener('DOMContentLoaded', paint);
  }

  function showBanner(text) {
    if (typeof document === 'undefined') return;
    function paint() {
      if (!document.body) return;
      var bar = document.getElementById('zedops-config-banner');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'zedops-config-banner';
        bar.setAttribute('role', 'status');
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;background:#F9A825;color:#1a1a1a;font-weight:700;font-size:15px;line-height:1.4;padding:12px 16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.2);';
        document.body.insertBefore(bar, document.body.firstChild);
      }
      bar.textContent = text;
    }
    if (document.body) paint();
    else document.addEventListener('DOMContentLoaded', paint);
  }

  function noteLocalLogin() {
    if (typeof document === 'undefined') return;
    var prompt = document.querySelector('#login-screen .login-box p');
    if (prompt) prompt.textContent = 'No ZedOps Staging project yet. A PIN here stays in this browser and is not checked online.';
  }

  function start(options) {
    var opts = options || {};
    var cfg = opts.config || (typeof window !== 'undefined' ? window.ZEDOPS_FIREBASE_CONFIG : {}) || {};
    var decision = classify(cfg);
    if (typeof window !== 'undefined') window.ZEDOPS_STAGING = decision;
    if (decision.mode === 'blocked') {
      showBlocked();
      return decision;
    }
    if (decision.mode === 'local') {
      showBanner(opts.banner || LOCAL_BANNER);
      noteLocalLogin();
      if (opts.storageKey) {
        var Zed = opts.ZedLocal || (typeof ZedLocal !== 'undefined' ? ZedLocal : null);
        if (Zed && Zed.createInventoryDb) {
          var storage = opts.storage;
          if (!storage && typeof localStorage !== 'undefined') storage = localStorage;
          decision.db = Zed.createInventoryDb({ storage: storage, storageKey: opts.storageKey });
        }
      }
      return decision;
    }
    var firebase = opts.firebase || (typeof window !== 'undefined' ? window.firebase : null);
    if (!firebase || !firebase.initializeApp) {
      decision.mode = 'local';
      decision.reason = 'no-sdk';
      if (typeof window !== 'undefined') window.ZEDOPS_STAGING = decision;
      showBanner('BROWSER ONLY — the Firebase scripts did not load. Changes stay in this browser. The live Production Hub was not contacted.');
      noteLocalLogin();
      return decision;
    }
    if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(cfg);
    decision.db = typeof firebase.database === 'function' ? firebase.database() : null;
    showBanner('STAGING Firebase project ' + decision.projectId + '. The live Production Hub is not connected.');
    return decision;
  }

  return {
    LIVE_ID: LIVE_ID,
    LOCAL_BANNER: LOCAL_BANNER,
    classify: classify,
    showBlocked: showBlocked,
    showBanner: showBanner,
    start: start
  };
});
