// Thursday–Wednesday value of meals sent to each store case.
// Tray, film, gas, and the food in the meal. Labor is not part of this number.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TransferCost = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var TZ = 'America/Chicago';
  var WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function money(value) {
    if (value == null) return null;
    var text = String(value).trim().replace(/[$,]/g, '');
    if (!text) return null;
    var n = Number(text);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  }

  function cents(dollars) {
    return Math.round((Number(dollars) || 0) * 100);
  }

  function fromCents(value) {
    return value / 100;
  }

  function dollars(amount) {
    return '$' + (Math.round((Number(amount) || 0) * 100) / 100).toFixed(2);
  }

  function partsOf(date) {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    var map = {};
    fmt.formatToParts(date).forEach(function (part) { map[part.type] = part.value; });
    return { y: +map.year, m: +map.month, d: +map.day, weekday: map.weekday };
  }

  function addDays(y, m, d, days) {
    var dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  function zonedMidnight(y, m, d) {
    var utc = Date.UTC(y, m - 1, d, 0, 0, 0);
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    var map = {};
    fmt.formatToParts(new Date(utc)).forEach(function (part) { map[part.type] = part.value; });
    var asUtc = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
    return utc - (asUtc - utc);
  }

  function labelDate(part, withWeekday) {
    var text = MONTHS[part.m - 1] + ' ' + part.d;
    return withWeekday ? withWeekday + ' ' + text : text;
  }

  function transferWeek(now) {
    var date = now instanceof Date ? now : new Date(now);
    if (isNaN(date.getTime())) date = new Date();
    var here = partsOf(date);
    var back = (WEEKDAYS[here.weekday] - WEEKDAYS.Thu + 7) % 7;
    var startPart = addDays(here.y, here.m, here.d, -back);
    var endPart = addDays(startPart.y, startPart.m, startPart.d, 7);
    var wed = addDays(startPart.y, startPart.m, startPart.d, 6);
    return {
      start: zonedMidnight(startPart.y, startPart.m, startPart.d),
      end: zonedMidnight(endPart.y, endPart.m, endPart.d),
      label: 'Thu ' + labelDate(startPart) + ' – Wed ' + labelDate(wed)
    };
  }

  function shiftWeek(week, delta) {
    var moved = delta < 0
      ? new Date(week.start - 12 * 60 * 60 * 1000)
      : new Date(week.end + 12 * 60 * 60 * 1000);
    return transferWeek(moved);
  }

  function readCosts(raw) {
    var src = raw || {};
    var product = {};
    Object.keys(src.product || {}).forEach(function (name) {
      var amount = money(src.product[name]);
      if (amount != null) product[name] = amount;
    });
    return {
      tray: money(src.tray) || 0,
      film: money(src.film) || 0,
      gas: money(src.gas) || 0,
      product: product
    };
  }

  function asList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return Object.keys(value).map(function (key) { return value[key]; }).filter(Boolean);
  }

  function caseLocation(locations, id) {
    var found = (locations || []).filter(function (loc) { return loc.id === id && loc.kind === 'case'; })[0];
    return found || null;
  }

  function rowsFromEntry(entry, locations) {
    var rows = [];
    if (!entry) return rows;
    if (entry.kind === 'split') {
      asList(entry.items).forEach(function (item) {
        var dish = item.dishName || item.name || item.dish;
        if (!dish) return;
        asList(item.allocations).forEach(function (slot) {
          var qty = parseInt(slot.caseQty, 10) || 0;
          if (qty <= 0) return;
          var loc = caseLocation(locations, slot.id);
          rows.push({
            caseId: loc ? loc.id : slot.id,
            caseName: loc ? loc.label : ((slot.name || slot.id || 'Case') + ' case'),
            dish: dish,
            qty: qty,
            source: 'split'
          });
        });
      });
      return rows;
    }
    var dest = caseLocation(locations, entry.to);
    if (!dest) return rows;
    asList(entry.items).forEach(function (item) {
      var qty = parseInt(item.qty, 10) || 0;
      if (qty <= 0) return;
      rows.push({
        caseId: dest.id,
        caseName: dest.label,
        dish: item.dishName || item.name || item.dish,
        qty: qty,
        source: 'transfer'
      });
    });
    return rows;
  }

  function summarize(entries, costs, locations, week) {
    var rates = readCosts(costs);
    var packEach = fromCents(cents(rates.tray) + cents(rates.film) + cents(rates.gas));
    var cases = {};
    (entries || []).forEach(function (entry) {
      var at = Number(entry && entry.timestamp);
      if (!isFinite(at) || at < week.start || at >= week.end) return;
      rowsFromEntry(entry, locations).forEach(function (row) {
        if (!row.dish) return;
        var card = cases[row.caseId] || { id: row.caseId, name: row.caseName, lines: {} };
        var line = card.lines[row.dish] || { dish: row.dish, qty: 0, split: false, transfer: false };
        line.qty += row.qty;
        line[row.source] = true;
        card.lines[row.dish] = line;
        cases[row.caseId] = card;
      });
    });

    var caseRows = Object.keys(cases).map(function (id) {
      var card = cases[id];
      var lines = Object.keys(card.lines).sort().map(function (dish) {
        var line = card.lines[dish];
        var productEach = Object.prototype.hasOwnProperty.call(rates.product, dish) ? rates.product[dish] : null;
        var packaging = fromCents(line.qty * cents(packEach));
        var productTotal = productEach == null ? null : fromCents(line.qty * cents(productEach));
        var how = line.split && line.transfer ? 'Split, transfer' : (line.split ? 'Split' : 'Transfer');
        return {
          dish: dish,
          qty: line.qty,
          how: how,
          tray: rates.tray,
          film: rates.film,
          gas: rates.gas,
          productEach: productEach,
          productMissing: productEach == null,
          packaging: packaging,
          productTotal: productTotal,
          sent: productTotal == null ? null : fromCents(cents(packaging) + cents(productTotal))
        };
      });
      var meals = lines.reduce(function (sum, line) { return sum + line.qty; }, 0);
      var complete = lines.filter(function (line) { return line.sent != null; });
      var sent = complete.length ? fromCents(complete.reduce(function (sum, line) { return sum + cents(line.sent); }, 0)) : 0;
      return {
        id: card.id,
        name: card.name,
        meals: meals,
        lines: lines,
        sent: sent,
        missing: lines.length - complete.length
      };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    var meals = caseRows.reduce(function (sum, row) { return sum + row.meals; }, 0);
    var missing = caseRows.reduce(function (sum, row) { return sum + row.missing; }, 0);
    var sent = fromCents(caseRows.reduce(function (sum, row) { return sum + cents(row.sent); }, 0));
    return {
      label: week.label,
      laborIncluded: false,
      tray: rates.tray,
      film: rates.film,
      gas: rates.gas,
      cases: caseRows,
      meals: meals,
      missing: missing,
      sent: sent
    };
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function reportHtml(summary) {
    var each = 'Each meal: tray ' + dollars(summary.tray) + ', film ' + dollars(summary.film) + ', gas ' + dollars(summary.gas) + '. Labor is not included.';
    if (!summary.cases.length) {
      return '<p class="hint">' + esc(each) + '</p><p class="hint">No meals were sent to a case ' + esc(summary.label) + '.</p>';
    }
    var cards = summary.cases.map(function (card) {
      var head = card.meals + ' meal' + (card.meals === 1 ? '' : 's');
      if (card.missing) head += ' · ' + dollars(card.sent) + ' so far · ' + card.missing + ' dish' + (card.missing === 1 ? '' : 'es') + ' still need a product cost';
      else head += ' · ' + dollars(card.sent) + ' sent';
      var body = card.lines.map(function (line) {
        var productCell = '<input data-product-dish="' + esc(line.dish) + '" inputmode="decimal" value="' +
          (line.productEach == null ? '' : line.productEach) + '" placeholder="Product $" aria-label="Product cost for ' + esc(line.dish) + '">';
        var sent = line.sent == null ? '—' : dollars(line.sent);
        return '<tr><td>' + esc(line.dish) + '<div class="hint">' + esc(line.how) + '</div></td><td>' + line.qty +
          '</td><td>' + productCell + '</td><td>' + dollars(line.packaging) + '</td><td>' + sent + '</td></tr>';
      }).join('');
      return '<section class="case-value-card"><h3>' + esc(card.name) + '</h3><p>' + esc(head) + '</p>' +
        '<div style="overflow-x:auto"><table class="case-value-table"><thead><tr><th>Dish</th><th>Meals</th><th>Product each</th><th>Tray, film, gas</th><th>Sent</th></tr></thead><tbody>' +
        body + '</tbody></table></div></section>';
    }).join('');
    var total = summary.meals + ' meals sent to cases';
    if (summary.missing) total += ' · ' + dollars(summary.sent) + ' so far · product cost still needed on ' + summary.missing + ' dish' + (summary.missing === 1 ? '' : 'es');
    else total += ' · ' + dollars(summary.sent) + ' in product and packaging';
    return '<p class="hint">' + esc(each) + '</p>' + cards + '<p class="case-value-total">' + esc(total) + '</p>';
  }

  return {
    money: money,
    dollars: dollars,
    transferWeek: transferWeek,
    shiftWeek: shiftWeek,
    readCosts: readCosts,
    summarize: summarize,
    reportHtml: reportHtml
  };
});
