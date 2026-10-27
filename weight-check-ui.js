// Weight-check screens for the Production Hub. Not used by inventory or transfers.
(function () {
  var storePromise = null;
  var cache = { targets: {}, checks: [] };

  function injectStyle() {
    if (document.getElementById('weightCheckStyle')) return;
    var style = document.createElement('style');
    style.id = 'weightCheckStyle';
    style.textContent = [
      '#weightOverlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:320;justify-content:center;align-items:flex-start;padding:40px 12px;overflow:auto;}',
      '#weightOverlay.show{display:flex;}',
      '#weightPanel{background:#fff;border-radius:16px;width:100%;max-width:860px;max-height:86vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,.2);}',
      '#weightPanel header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #e0e0e0;position:sticky;top:0;background:#fff;}',
      '#weightPanel h2{font-size:18px;color:#1B5E20;margin:0;}',
      '#weightPanel .body{padding:16px 20px 24px;}',
      '#weightPanel .tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}',
      '#weightPanel .tabs button,#weightPanel .actions button{padding:8px 12px;border-radius:8px;border:1px solid #ccc;background:#fff;font-weight:700;cursor:pointer;}',
      '#weightPanel .tabs button.active{background:#1B5E20;color:#fff;border-color:#1B5E20;}',
      '#weightPanel label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:#666;text-transform:uppercase;}',
      '#weightPanel input,#weightPanel select{font-size:16px;padding:8px;border:1.5px solid #ddd;border-radius:8px;font-family:inherit;}',
      '#weightPanel .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:8px 0 12px;}',
      '#weightPanel .note{font-size:13px;color:#555;margin:0 0 12px;line-height:1.4;}',
      '#weightPanel .setting-row{display:grid;grid-template-columns:1fr 90px 90px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;}',
      '.weight-report{overflow-x:auto;}',
      '.weight-table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 16px;min-width:720px;}',
      '.weight-table th,.weight-table td{border-bottom:1px solid #eee;padding:6px 8px;text-align:left;}',
      '.weight-miss{background:#FFEBEE;color:#B71C1C;font-weight:700;}',
      '.weight-empty{color:#777;font-size:13px;}',
      '.weight-report h3{font-size:15px;margin:14px 0 6px;}'
    ].join('');
    document.head.appendChild(style);
  }

  function stagingStore() {
    if (!storePromise) {
      storePromise = WeightStore.open({
        config: window.ZEDOPS_FIREBASE_CONFIG,
        firebase: window.firebase
      }).then(function (store) {
        if (!store || store.mode === 'blocked') {
          var blocked = new Error(store && store.reason === 'live-blocked'
            ? 'Weight checks will not use the live Production Hub.'
            : 'Weight checks are not available.');
          blocked.code = 'weight/blocked';
          throw blocked;
        }
        return store.load().then(function (data) {
          cache = data && data.targets ? data : { targets: {}, checks: [] };
          if (!cache.checks) cache.checks = [];
          store._cache = cache;
          return store;
        });
      }).catch(function (err) {
        storePromise = null;
        throw err;
      });
    }
    return storePromise;
  }

  function persist() {
    return stagingStore().then(function (store) { return store.save(cache); });
  }

  function dayNames() {
    if (typeof sortedDays === 'function') return sortedDays();
    return Object.keys(typeof PRODUCTION_DATA !== 'undefined' ? PRODUCTION_DATA : {});
  }

  function sequenceFor(day) {
    var data = typeof PRODUCTION_DATA !== 'undefined' ? PRODUCTION_DATA[day] : null;
    return WeightCheck.platingSequence(data || {});
  }

  function dishNames() {
    var seen = {};
    var names = [];
    dayNames().forEach(function (day) {
      sequenceFor(day).forEach(function (row) {
        if (seen[row.name]) return;
        seen[row.name] = true;
        names.push(row.name);
      });
      var queue = (typeof PRODUCTION_DATA !== 'undefined' && PRODUCTION_DATA[day] && PRODUCTION_DATA[day].Queue && PRODUCTION_DATA[day].Queue.dishes) || [];
      queue.forEach(function (dish) {
        if (!dish || !dish.name || seen[dish.name]) return;
        seen[dish.name] = true;
        names.push(dish.name);
      });
    });
    return names.sort();
  }

  function openWeightCheck() {
    injectStyle();
    stagingStore().then(function () {
      document.getElementById('weightOverlay').classList.add('show');
      showWeightTab('sheet');
    }).catch(function (err) {
      var message = (err && err.message) ? err.message : 'Sign in before weight checks';
      if (typeof showSaveNotice === 'function') showSaveNotice(message);
      else window.alert(message);
    });
  }

  function closeWeightCheck() {
    var el = document.getElementById('weightOverlay');
    if (el) el.classList.remove('show');
  }

  function showWeightTab(tab) {
    var body = document.getElementById('weightBody');
    if (!body) return;
    document.querySelectorAll('#weightTabs button').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    if (tab === 'sheet') body.innerHTML = sheetTab();
    else if (tab === 'enter') body.innerHTML = enterTab();
    else if (tab === 'settings') body.innerHTML = settingsTab();
    else body.innerHTML = reportTab();
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sheetTab() {
    var day = typeof currentDay !== 'undefined' ? currentDay : dayNames()[0];
    var options = dayNames().map(function (name) {
      return '<option' + (name === day ? ' selected' : '') + '>' + name + '</option>';
    }).join('');
    return '<p class="note">Print this for the line. Plating stays on paper. Check 1 is the 8th plate on the first tray. Check 2 is a plate from a middle tray.</p>' +
      '<div class="grid"><label>Day<select id="weightSheetDay">' + options + '</select></label></div>' +
      '<div class="actions"><button type="button" onclick="printWeightSheet()">Print weight check sheet</button></div>';
  }

  function enterTab() {
    var day = typeof currentDay !== 'undefined' ? currentDay : dayNames()[0];
    var days = dayNames().map(function (name) {
      return '<option' + (name === day ? ' selected' : '') + '>' + name + '</option>';
    }).join('');
    var dishes = dishNames().map(function (name) { return '<option>' + esc(name) + '</option>'; }).join('');
    return '<p class="note">Hannah enters the sheet at the end of the day. Pass or miss is marked from the target and tolerance. This save does not go to the live hub.</p>' +
      '<div class="grid">' +
      '<label>Day<select id="weightDay">' + days + '</select></label>' +
      '<label>Dish<select id="weightDish">' + dishes + '</select></label>' +
      '<label>Check #<select id="weightCheckNo"><option>1</option><option>2</option></select></label>' +
      '<label>Weight (g)<input id="weightGrams" inputmode="numeric"></label>' +
      '<label>Plater initials<input id="weightPlater" maxlength="6"></label>' +
      '<label>Checker initials<input id="weightChecker" maxlength="6"></label>' +
      '<label>Recheck weight (g)<input id="weightRecheck" inputmode="numeric" placeholder="Optional"></label>' +
      '</div><div class="actions"><button type="button" onclick="saveWeightEntry()">Save weight check</button></div>' +
      '<div id="weightEntryResult"></div>';
  }

  function settingsTab() {
    var rows = dishNames().map(function (name) {
      var setting = cache.targets[name] || {};
      var target = setting.target || '';
      var tolerance = setting.tolerance != null ? setting.tolerance : WeightCheck.DEFAULT_TOLERANCE;
      return '<div class="setting-row"><span>' + esc(name) + '</span>' +
        '<input data-weight-dish="' + esc(name) + '" data-weight-field="target" value="' + esc(target) + '" placeholder="340 or Serving size (340g)">' +
        '<input data-weight-dish="' + esc(name) + '" data-weight-field="tolerance" value="' + esc(tolerance) + '" inputmode="numeric"></div>';
    }).join('');
    return '<p class="note">Target weight is the serving size on the label, in grams. Tolerance defaults to ±20g. Pass range is target minus tolerance through target plus tolerance.</p>' +
      '<div class="setting-row"><strong>Dish</strong><strong>Target g</strong><strong>± g</strong></div>' + rows +
      '<div class="actions" style="margin-top:12px;"><button type="button" onclick="saveWeightTargets()">Save targets</button></div>';
  }

  function reportTab() {
    var day = typeof currentDay !== 'undefined' ? currentDay : '';
    return WeightCheck.reportHtml({ checks: cache.checks, days: day ? [day] : null });
  }

  function printWeightSheet() {
    var select = document.getElementById('weightSheetDay');
    var day = select ? select.value : (typeof currentDay !== 'undefined' ? currentDay : '');
    var blocks = WeightCheck.sheetBlocks(sequenceFor(day), cache.targets);
    var html = WeightCheck.printDocument(day, blocks);
    var frame = document.getElementById('weightPrintFrame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'weightPrintFrame';
      frame.setAttribute('title', 'Weight check sheet');
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;';
      document.body.appendChild(frame);
    }
    var doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }

  function saveWeightTargets() {
    document.querySelectorAll('#weightBody [data-weight-dish]').forEach(function (input) {
      var name = input.getAttribute('data-weight-dish');
      var field = input.getAttribute('data-weight-field');
      cache.targets[name] = cache.targets[name] || { tolerance: WeightCheck.DEFAULT_TOLERANCE };
      if (field === 'target') {
        var parsed = WeightCheck.parseServingSize(input.value);
        if (parsed) cache.targets[name].target = parsed;
        else if (!String(input.value).trim()) delete cache.targets[name].target;
      } else {
        var tol = parseInt(input.value, 10);
        cache.targets[name].tolerance = isFinite(tol) && tol >= 0 ? tol : WeightCheck.DEFAULT_TOLERANCE;
      }
    });
    persist().then(function () {
      if (typeof showSaveNotice === 'function') showSaveNotice('Weight targets saved on staging');
    });
  }

  function saveWeightEntry() {
    var result = WeightCheck.recordCheck({
      day: document.getElementById('weightDay').value,
      dish: document.getElementById('weightDish').value,
      check: document.getElementById('weightCheckNo').value,
      weight: document.getElementById('weightGrams').value,
      plater: document.getElementById('weightPlater').value,
      checker: document.getElementById('weightChecker').value,
      recheck: document.getElementById('weightRecheck').value
    }, cache.targets);
    var box = document.getElementById('weightEntryResult');
    if (!result.ok) {
      box.innerHTML = '<p class="weight-miss">' + result.error + '</p>';
      return;
    }
    result.entry.id = 'w' + Date.now();
    result.entry.at = new Date().toISOString();
    cache.checks.push(result.entry);
    persist().then(function () {
      var entry = result.entry;
      var recheck = entry.recheck == null ? '' : ' Recheck ' + entry.recheck + 'g is a ' + (entry.recheckResult === 'pass' ? 'pass' : 'miss') + '.';
      box.innerHTML = '<p>Saved. ' + entry.weight + 'g is a ' + (entry.result === 'pass' ? 'pass' : 'miss') + ' (' + entry.low + '–' + entry.high + 'g).' + recheck + '</p>';
      if (typeof showSaveNotice === 'function') showSaveNotice('Weight check saved on staging');
    });
  }

  function renderHistoryReport(mount, days) {
    if (!mount) return;
    stagingStore().then(function () {
      mount.innerHTML = WeightCheck.reportHtml({ checks: cache.checks, days: days || [] });
    }).catch(function () {
      mount.innerHTML = '<p class="weight-empty">Weight checks are not available until you are signed in.</p>';
    });
  }

  window.openWeightCheck = openWeightCheck;
  window.closeWeightCheck = closeWeightCheck;
  window.showWeightTab = showWeightTab;
  window.printWeightSheet = printWeightSheet;
  window.saveWeightTargets = saveWeightTargets;
  window.saveWeightEntry = saveWeightEntry;
  window.WeightUI = { renderHistoryReport: renderHistoryReport, open: openWeightCheck };
})();
