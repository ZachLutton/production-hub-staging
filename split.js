// Pure split, rebalance, and oldest-first helpers for ZedOps inventory.
// No Firebase and no DOM. The inventory page and node:test both load this file.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedSplit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var DEFAULT_CONFIG = {
    colonnadeShare: 0.6,
    stackRegular: 6,
    stackSmall: 7,
    smallMatchers: ['1/2#'],
    leaveAtLeast: 5,
    skipList: ['Beef Taco Skillet']
  };

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function asShare(value, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    if (n > 1) n = n / 100;
    return clamp(n, 0, 1);
  }

  function roundToStack(qty, stack) {
    var q = Number(qty) || 0;
    var s = Math.round(Number(stack) || 1);
    if (s <= 1) return Math.max(0, Math.round(q));
    return Math.max(0, Math.round(q / s) * s);
  }

  function normalizeName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function normalizeBarcode(value) {
    return String(value || '').replace(/[\s*]/g, '').trim();
  }

  function isSkipped(name, skipList) {
    var n = normalizeName(name);
    if (!n) return false;
    return (skipList || []).some(function (entry) {
      var key = normalizeName(entry);
      if (!key) return false;
      if (key.length < 4) return n === key;
      return n.indexOf(key) !== -1 || key.indexOf(n) !== -1;
    });
  }

  function isSmallDish(name, matchers) {
    var n = String(name || '').toLowerCase();
    var list = matchers && matchers.length ? matchers : ['1/2#'];
    return list.some(function (m) { return n.indexOf(String(m).toLowerCase()) !== -1; });
  }

  function stackSizeFor(name, config) {
    var cfg = config || DEFAULT_CONFIG;
    var regular = Math.max(1, Math.round(Number(cfg.stackRegular) || DEFAULT_CONFIG.stackRegular));
    var small = Math.max(1, Math.round(Number(cfg.stackSmall) || DEFAULT_CONFIG.stackSmall));
    return isSmallDish(name, cfg.smallMatchers) ? small : regular;
  }

  function colonnadeShareFor(row, config) {
    var cfg = config || DEFAULT_CONFIG;
    if (row && row.colonnadeShare != null && row.colonnadeShare !== '') return asShare(row.colonnadeShare, cfg.colonnadeShare);
    if (row && cfg.perDish && cfg.perDish[row.dish] != null) return asShare(cfg.perDish[row.dish], cfg.colonnadeShare);
    return asShare(cfg.colonnadeShare, DEFAULT_CONFIG.colonnadeShare);
  }

  // Prepaid pickups stay at the store the customer chose. Delivery units are
  // committed to the Rim, because deliveries leave from the Rim. The walk-in
  // remainder is split by share and rounded to stacks. The two stores always
  // add up to the plated count. A minimum stack is taken only from walk-in
  // plates, never from another store's prepaid pickup.
  function splitDish(row, config) {
    var cfg = config || DEFAULT_CONFIG;
    var name = row && row.dish ? String(row.dish) : '';
    var stackSize = stackSizeFor(name, cfg);
    var plated = Math.max(0, Math.round(Number(row && row.plated) || 0));
    var skipList = cfg.skipList || DEFAULT_CONFIG.skipList;
    var requestedPickupC = Math.max(0, Math.round(Number(row && row.prepaidColonnade) || 0));
    var requestedPickupR = Math.max(0, Math.round(Number(row && row.prepaidRim) || 0));
    var requestedDelivery = Math.max(0, Math.round(Number(row && row.delivery) || 0));
    var share = colonnadeShareFor(row, cfg);
    var warnings = [];

    if (isSkipped(name, skipList)) {
      return {
        dish: name, skipped: true, plated: plated, colonnade: 0, rim: 0,
        prepaidColonnade: 0, prepaidRim: 0, delivery: 0,
        walkInColonnade: 0, walkInRim: 0, stackSize: stackSize,
        colonnadeShare: share, warnings: ['On the skip list']
      };
    }

    var pickupNeed = requestedPickupC + requestedPickupR;
    var pc, pr, del, rest;
    if (pickupNeed > plated) {
      if (pickupNeed === 0) { pc = 0; pr = 0; }
      else {
        pc = Math.floor(plated * requestedPickupC / pickupNeed);
        pr = plated - pc;
      }
      del = 0;
      rest = 0;
      warnings.push('Plated count does not cover prepaid pickups');
    } else {
      pc = requestedPickupC;
      pr = requestedPickupR;
      var afterPickup = plated - pc - pr;
      del = Math.min(requestedDelivery, afterPickup);
      rest = afterPickup - del;
      if (del < requestedDelivery) warnings.push('Plated count does not cover delivery orders');
    }

    var walkC = roundToStack(rest * share, stackSize);
    if (walkC > rest) walkC = Math.floor(rest / stackSize) * stackSize;
    if (walkC < 0) walkC = 0;
    var walkR = rest - walkC;

    var colonnade = pc + walkC;
    var rim = pr + del + walkR;

    if (plated >= stackSize * 2) {
      if (colonnade < stackSize) {
        var needC = stackSize - colonnade;
        var moveC = Math.min(needC, walkR);
        walkR -= moveC;
        walkC += moveC;
        colonnade += moveC;
        rim -= moveC;
      }
      if (rim < stackSize) {
        var needR = stackSize - rim;
        var moveR = Math.min(needR, walkC);
        walkC -= moveR;
        walkR += moveR;
        rim += moveR;
        colonnade -= moveR;
      }
      if (colonnade < stackSize || rim < stackSize) {
        warnings.push('Not enough uncommitted plates for 1 stack at each store');
      }
    } else if (plated > 0 && (colonnade < stackSize || rim < stackSize)) {
      warnings.push('Plated count is below two stacks');
    }

    if (colonnade + rim !== plated) warnings.push('Split does not add up to plated count');

    return {
      dish: name,
      skipped: false,
      plated: plated,
      colonnade: colonnade,
      rim: rim,
      prepaidColonnade: pc,
      prepaidRim: pr,
      delivery: del,
      walkInColonnade: walkC,
      walkInRim: walkR,
      stackSize: stackSize,
      colonnadeShare: share,
      warnings: warnings
    };
  }

  function splitBatch(rows, config) {
    return (rows || []).map(function (row) { return splitDish(row, config); });
  }

  // Move floor(onHand / 2), but never leave fewer than `leaveAtLeast` when the
  // stocked store is at or above that line. Orange-star meals at a store whose
  // partner is out still suggest a move when the case is under that line,
  // leaving at least 1. Suggestions only — this does not change quantities.
  function storeTransferQty(fromQty, orangeStar, leaveAtLeast) {
    var qty = Math.max(0, Math.round(Number(fromQty) || 0));
    var star = Math.max(0, Math.round(Number(orangeStar) || 0));
    var leave = Math.max(0, Math.round(Number(leaveAtLeast) || 0));
    if (qty >= leave && leave > 0) {
      return { qty: Math.min(Math.floor(qty / 2), qty - leave), reason: 'surplus' };
    }
    if (star > 0 && qty > 1) {
      return { qty: Math.min(star, Math.floor(qty / 2), qty - 1), reason: 'orange-star' };
    }
    return { qty: 0, reason: '' };
  }

  function rebalanceSuggestions(input) {
    var dishes = (input && input.dishes) || [];
    var leaveAtLeast = input && input.leaveAtLeast != null ? input.leaveAtLeast : DEFAULT_CONFIG.leaveAtLeast;
    var skipList = (input && input.skipList) || [];
    var suggestions = [];

    dishes.forEach(function (dish) {
      var name = dish.name || dish.dish;
      if (!name || isSkipped(name, skipList)) return;
      var caseC = Math.max(0, Math.round(Number(dish.colonnade) || 0));
      var caseR = Math.max(0, Math.round(Number(dish.rim) || 0));
      var backC = Math.max(0, Math.round(Number(dish.colonnadeBackstock) || 0));
      var backR = Math.max(0, Math.round(Number(dish.rimBackstock) || 0));

      [['colonnade', caseC, backC], ['rim', caseR, backR]].forEach(function (pair) {
        if (pair[1] <= 0 && pair[2] > 0) {
          suggestions.push({
            name: name,
            from: pair[0] + '_backstock',
            to: pair[0],
            qty: pair[2],
            reason: 'backstock',
            note: 'Case is empty. Pull from this store\'s backstock cooler, oldest first. Edit the quantity before logging.'
          });
        }
      });

      function consider(fromQty, toQty, star, from, to) {
        if (toQty > 0) return;
        var move = storeTransferQty(fromQty, star, leaveAtLeast);
        if (move.qty < 1) return;
        suggestions.push({
          name: name,
          from: from,
          to: to,
          qty: move.qty,
          reason: move.reason,
          note: move.reason === 'orange-star'
            ? 'Other store is out and this store has orange-star meals. Move oldest first.'
            : 'Out at one store and ' + leaveAtLeast + ' or more at the other. Move half, leave at least ' + leaveAtLeast + ', oldest first.'
        });
      }

      consider(caseC, caseR, dish.orangeStarColonnade, 'colonnade', 'rim');
      consider(caseR, caseC, dish.orangeStarRim, 'rim', 'colonnade');
    });

    return suggestions;
  }

  // One stack of share toward outs and away from orange star. Agreed signals
  // still move a single stack. Conflicting signals are left unchanged.
  function proposeShareShifts(input) {
    var cfg = input || {};
    var baseShare = asShare(cfg.colonnadeShare, DEFAULT_CONFIG.colonnadeShare);
    var perDish = cfg.perDish || {};
    var skipList = cfg.skipList || [];
    var outs = {};
    var stars = {};

    (cfg.stockouts || []).forEach(function (row) {
      var name = row.name || row.dishName || row.dish;
      var store = row.store || row.location;
      if (!name || (store !== 'colonnade' && store !== 'rim')) return;
      if (store.indexOf('backstock') !== -1) return;
      outs[name] = outs[name] || { colonnade: false, rim: false };
      outs[name][store] = true;
    });
    (cfg.orangeStar || []).forEach(function (row) {
      var name = row.name || row.dishName || row.dish;
      var store = row.store || row.location;
      if (!name || (store !== 'colonnade' && store !== 'rim')) return;
      stars[name] = stars[name] || { colonnade: 0, rim: 0 };
      stars[name][store] += Math.max(0, Math.round(Number(row.qty) || 0));
    });

    var names = {};
    (cfg.dishes || []).forEach(function (d) { if (d && (d.name || d.dish)) names[d.name || d.dish] = d; });
    Object.keys(outs).forEach(function (n) { names[n] = names[n] || { name: n }; });
    Object.keys(stars).forEach(function (n) { names[n] = names[n] || { name: n }; });

    return Object.keys(names).sort().map(function (name) {
      var dish = names[name];
      var label = dish.name || dish.dish || name;
      if (isSkipped(label, skipList)) return null;
      var o = outs[name] || outs[label] || { colonnade: false, rim: false };
      var s = stars[name] || stars[label] || { colonnade: 0, rim: 0 };
      var towardRim = 0;
      var towardCol = 0;
      if (o.rim && !o.colonnade) towardRim += 1;
      if (o.colonnade && !o.rim) towardCol += 1;
      if (s.colonnade > 0 && !(s.rim > 0)) towardRim += 1;
      if (s.rim > 0 && !(s.colonnade > 0)) towardCol += 1;
      var current = perDish[label] != null ? asShare(perDish[label], baseShare) : baseShare;
      if (towardRim && towardCol) {
        return { dish: label, current: current, next: current, direction: 'none', note: 'Outs and orange star point different ways. No change.' };
      }
      if (!towardRim && !towardCol) return null;
      var stack = stackSizeFor(label, cfg);
      var plated = Math.max(0, Math.round(Number(dish.plated) || 0));
      var basis = plated > 0 ? plated : 100;
      var delta = stack / basis;
      var next = clamp(current + (towardCol ? delta : -delta), 0.05, 0.95);
      return {
        dish: label,
        current: current,
        next: next,
        delta: next - current,
        stack: stack,
        basis: basis,
        direction: towardCol ? 'colonnade' : 'rim',
        note: 'Shift 1 stack toward ' + (towardCol ? 'Colonnade' : 'the Rim') + '.'
      };
    }).filter(Boolean).filter(function (row) { return row.direction === 'none' || Math.abs(row.next - row.current) > 0.0001; });
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function addDaysIso(iso, days) {
    var parts = String(iso || '').split('-').map(Number);
    var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    dt.setUTCDate(dt.getUTCDate() + (Math.round(Number(days) || 0)));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  function isoToUseByKey(iso) {
    var parts = String(iso || '').split('-').map(Number);
    return parts[1] + '-' + parts[2];
  }

  function useByKeyToIso(key, todayIso) {
    var bits = String(key || '').split('-').map(Number);
    var month = bits[0];
    var day = bits[1];
    var todayParts = String(todayIso || '2026-01-01').split('-').map(Number);
    var today = Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]);
    var best = null;
    [todayParts[0] - 1, todayParts[0], todayParts[0] + 1].forEach(function (year) {
      var stamp = Date.UTC(year, month - 1, day);
      var dist = Math.round((stamp - today) / 86400000);
      var inWindow = dist >= -21 && dist <= 21;
      var score = (inWindow ? 0 : 1000) + Math.abs(dist);
      if (!best || score < best.score) {
        var dt = new Date(stamp);
        best = {
          score: score,
          iso: dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate())
        };
      }
    });
    return best ? best.iso : todayIso;
  }

  function allocateOldestFirst(lots, need, todayIso) {
    var left = Math.max(0, Math.round(Number(need) || 0));
    var sorted = (lots || []).map(function (lot) {
      return {
        useBy: lot.useBy,
        qty: Math.max(0, Math.round(Number(lot.qty) || 0)),
        iso: useByKeyToIso(lot.useBy, todayIso)
      };
    }).filter(function (lot) { return lot.qty > 0 && lot.useBy; });
    sorted.sort(function (a, b) {
      if (a.iso < b.iso) return -1;
      if (a.iso > b.iso) return 1;
      return 0;
    });
    var moves = [];
    sorted.forEach(function (lot) {
      if (left <= 0) return;
      var take = Math.min(left, lot.qty);
      moves.push({ useBy: lot.useBy, iso: lot.iso, qty: take });
      left -= take;
    });
    var moved = Math.max(0, Math.round(Number(need) || 0)) - left;
    return { moves: moves, moved: moved, shortfall: left };
  }

  function splitCsvLine(line) {
    var out = [];
    var cur = '';
    var quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function normalizeStore(value) {
    var s = String(value || '').toLowerCase().trim();
    if (s === 'rim' || s === 'r' || s === 'the rim') return 'rim';
    if (s === 'colonnade' || s === 'col' || s === 'c' || s === 'colonade') return 'colonnade';
    return '';
  }

  function normalizeChannel(value) {
    var s = String(value || '').toLowerCase().trim();
    if (s === 'delivery' || s === 'del' || s === 'd') return 'delivery';
    return 'pickup';
  }

  function parsePrepaidCsv(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return [];
    var header = splitCsvLine(lines[0]).map(function (h) { return h.toLowerCase(); });
    var known = { dish: 1, name: 1, store: 1, location: 1, qty: 1, quantity: 1, type: 1, channel: 1 };
    var hasHeader = header.some(function (h) { return known[h]; });
    function col(names, fallback) {
      if (!hasHeader) return fallback;
      for (var i = 0; i < names.length; i++) {
        var at = header.indexOf(names[i]);
        if (at >= 0) return at;
      }
      return -1;
    }
    var dishCol = col(['dish', 'name'], 0);
    var storeCol = col(['store', 'location'], 1);
    var qtyCol = col(['qty', 'quantity'], 2);
    var typeCol = col(['type', 'channel'], 3);
    var rows = [];
    for (var i = hasHeader ? 1 : 0; i < lines.length; i++) {
      var cells = splitCsvLine(lines[i]);
      var dish = dishCol >= 0 ? cells[dishCol] : '';
      var qty = Math.round(Number(qtyCol >= 0 ? cells[qtyCol] : 0) || 0);
      if (!dish || qty === 0) continue;
      rows.push({
        dish: dish,
        store: normalizeStore(storeCol >= 0 ? cells[storeCol] : ''),
        qty: Math.abs(qty),
        type: normalizeChannel(typeCol >= 0 ? cells[typeCol] : '')
      });
    }
    return rows;
  }

  function aggregateOrders(rows) {
    var by = {};
    (rows || []).forEach(function (row) {
      if (!row || !row.dish) return;
      if (!by[row.dish]) by[row.dish] = { dish: row.dish, prepaidColonnade: 0, prepaidRim: 0, delivery: 0 };
      var qty = Math.max(0, Math.round(Number(row.qty) || 0));
      if (row.type === 'delivery') by[row.dish].delivery += qty;
      else if (row.store === 'rim') by[row.dish].prepaidRim += qty;
      else by[row.dish].prepaidColonnade += qty;
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  function platedFromProduction(data, dayKeys) {
    var days = Array.isArray(dayKeys) ? dayKeys : [dayKeys];
    var map = {};
    days.forEach(function (day) {
      var block = data && data[day];
      if (!block || typeof block !== 'object') return;
      Object.keys(block).forEach(function (stationName) {
        var station = block[stationName];
        var dishes = station && station.dishes;
        if (!Array.isArray(dishes)) return;
        dishes.forEach(function (dish) {
          if (!dish || !dish.name) return;
          if (!map[dish.name]) map[dish.name] = { dish: dish.name, plated: 0, fromFinal: 0, fromOrdered: 0 };
          var finalBlank = dish.finalCount == null || String(dish.finalCount).trim() === '';
          var carried = !!(dish.carriedTo || dish.fullOrdered);
          if (!finalBlank) {
            var finished = parseInt(dish.finalCount, 10) || 0;
            map[dish.name].plated += finished;
            map[dish.name].fromFinal += finished;
          } else if (!carried) {
            var ordered = parseInt(dish.ordered, 10) || 0;
            map[dish.name].plated += ordered;
            map[dish.name].fromOrdered += ordered;
          }
        });
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function lookupBarcode(code, map) {
    var norm = normalizeBarcode(code);
    if (!norm || !map) return null;
    if (map[norm]) return { code: norm, dish: map[norm].dish || map[norm].dishName || map[norm] };
    var stripped = norm.replace(/^0+/, '');
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var keyNorm = normalizeBarcode(keys[i]).replace(/^0+/, '');
      if (stripped && keyNorm === stripped) {
        var hit = map[keys[i]];
        return { code: keys[i], dish: hit.dish || hit.dishName || hit };
      }
    }
    return null;
  }

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    asShare: asShare,
    roundToStack: roundToStack,
    normalizeName: normalizeName,
    normalizeBarcode: normalizeBarcode,
    isSkipped: isSkipped,
    isSmallDish: isSmallDish,
    stackSizeFor: stackSizeFor,
    splitDish: splitDish,
    splitBatch: splitBatch,
    storeTransferQty: storeTransferQty,
    rebalanceSuggestions: rebalanceSuggestions,
    proposeShareShifts: proposeShareShifts,
    addDaysIso: addDaysIso,
    isoToUseByKey: isoToUseByKey,
    useByKeyToIso: useByKeyToIso,
    allocateOldestFirst: allocateOldestFirst,
    parsePrepaidCsv: parsePrepaidCsv,
    aggregateOrders: aggregateOrders,
    platedFromProduction: platedFromProduction,
    lookupBarcode: lookupBarcode
  };
});
