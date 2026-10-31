// Turns a scaled-recipe layout (the text of the weekly PDF) into raw purchase totals.
// A later download can feed the same text. Nothing here talks to Firebase.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedRecipe = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function normalizeName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function nameKey(value) {
    return normalizeName(value).replace(/ /g, '_').slice(0, 80);
  }

  function num(value) {
    var n = Number(String(value || '').replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function linesOf(text) {
    return String(text || '').replace(/\f/g, '\n').split(/\n/).map(function (line) {
      return line.replace(/\s+$/g, '');
    }).filter(function (line) {
      var t = line.trim();
      if (!t) return false;
      if (/^Colonnade Scaled Recipes\b/i.test(t)) return false;
      if (/^Generated on /i.test(t)) return false;
      return true;
    });
  }

  function parseTitle(line) {
    var match = String(line).trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+Pounds\s+\(lbs\)\s*$/i);
    if (!match) return null;
    return { name: match[1].trim(), pounds: Number(match[2]) };
  }

  function parseDataRow(line) {
    var text = String(line).replace(/\s+$/g, '');
    var match = text.match(/^(.*?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d.]+%)\s*$/);
    if (!match) return null;
    var pounds = num(match[3]);
    if (pounds == null) return null;
    return { name: match[1].trim(), grams: num(match[2]), pounds: pounds, ratio: match[4] };
  }

  function cookDateFrom(text) {
    var match = String(text).match(/Scaled Recipes for\s+[A-Za-z]+\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i);
    if (!match) return '';
    var month = MONTHS[match[1].toLowerCase()];
    if (!month) return '';
    return match[3] + '-' + String(month).padStart(2, '0') + '-' + String(match[2]).padStart(2, '0');
  }

  function cleanIngredientName(value) {
    return String(value || '').replace(/\s*Preparation Instructions[\s\S]*$/i, '').replace(/\s+/g, ' ').trim();
  }

  function parseIngredients(lines) {
    var ingredients = [];
    var pending = [];
    var current = null;
    var skipping = false;
    function finish() {
      if (current && current.pounds != null) {
        var name = cleanIngredientName([].concat(pending, current.name ? [current.name] : []).join(' '));
        if (name) ingredients.push({ name: name, pounds: current.pounds, grams: current.grams, unit: 'lb' });
      }
      pending = [];
      current = null;
    }
    lines.forEach(function (raw) {
      var line = String(raw).trim();
      if (!line || /^\s*Ingredient\b/i.test(line)) return;
      if (/Preparation Instructions/i.test(line)) {
        if (current && current.name) current.name = current.name.replace(/\s*Preparation Instructions.*/i, '').trim();
        skipping = true;
        return;
      }
      var row = parseDataRow(raw);
      if (row) {
        skipping = false;
        if (row.name) {
          finish();
          current = row;
        } else if (current) {
          current.pounds = row.pounds;
          current.grams = row.grams;
        } else current = row;
        return;
      }
      if (skipping) return;
      if (current && current.pounds == null) pending.push(line);
      else if (current && current.pounds != null) current.name = ((current.name || '') + ' ' + line).trim();
      else pending.push(line);
    });
    finish();
    return ingredients;
  }

  function isSectionHeader(line) {
    var text = String(line || '').trim();
    if (!text || text.length > 80) return false;
    if (/\d/.test(text)) return false;
    if (/^ingredient\b/i.test(text)) return false;
    if (/^items needed from broadline$/i.test(text)) return true;
    return /[A-Za-z]/.test(text);
  }

  function parseBlocks(text) {
    var lines = linesOf(text);
    var blocks = [];
    var current = null;
    lines.forEach(function (line) {
      var title = parseTitle(line);
      if (title) {
        if (current) blocks.push(current);
        current = { name: title.name, pounds: title.pounds, lines: [] };
        return;
      }
      if (current) current.lines.push(line);
    });
    if (current) blocks.push(current);
    var section = 'broadline';
    blocks.forEach(function (block) {
      var before = [];
      var after = [];
      var seen = false;
      block.lines.forEach(function (line) {
        if (!seen && /^\s*Ingredient\b/i.test(line)) { seen = true; return; }
        if (!seen) before.push(line);
        else after.push(line);
      });
      before.forEach(function (line) {
        if (/items needed from broadline/i.test(line)) section = 'broadline';
        else if (isSectionHeader(line)) section = 'recipes';
      });
      block.section = section;
      block.ingredients = parseIngredients(after.length ? after : block.lines);
      // A station name can sit at the end of the previous block, after its ingredients.
      var trailing = [];
      var started = false;
      for (var i = block.lines.length - 1; i >= 0; i--) {
        var row = parseDataRow(block.lines[i]);
        if (row) break;
        if (/Preparation Instructions/i.test(block.lines[i])) break;
        if (isSectionHeader(block.lines[i]) && !/ingredient/i.test(block.lines[i])) trailing.unshift(block.lines[i]);
        else if (trailing.length) break;
        started = true;
      }
      block.nextSection = trailing.some(function (line) { return !/items needed from broadline/i.test(line); }) ? 'recipes' : '';
      if (started && block.nextSection === 'recipes') section = 'recipes';
    });
    return blocks;
  }

  function findByName(map, name) {
    return map[normalizeName(name)] || null;
  }

  function addTotal(totals, name, pounds, source) {
    var key = normalizeName(name);
    if (!key || /^water\b/.test(key)) return;
    if (!(pounds > 0)) return;
    if (!totals[key]) totals[key] = { key: nameKey(name), name: name, pounds: 0, unit: 'lb', sources: [] };
    totals[key].pounds = round3(totals[key].pounds + pounds);
    if (totals[key].sources.indexOf(source) === -1) totals[key].sources.push(source);
  }

  function parseScaledRecipes(text) {
    var blocks = parseBlocks(text);
    var broadline = [];
    var recipes = [];
    blocks.forEach(function (block) {
      if (block.section === 'broadline') {
        broadline.push({ name: block.name, pounds: block.pounds, unit: 'lb', ingredients: block.ingredients });
      } else {
        recipes.push({ name: block.name, yieldPounds: block.pounds, ingredients: block.ingredients });
      }
    });
    var broadlineByName = {};
    var recipeByName = {};
    broadline.forEach(function (item) { broadlineByName[normalizeName(item.name)] = item; });
    recipes.forEach(function (recipe) { recipeByName[normalizeName(recipe.name)] = recipe; });

    var totals = {};
    broadline.forEach(function (item) { addTotal(totals, item.name, item.pounds, 'broadline'); });
    recipes.forEach(function (recipe) {
      recipe.ingredients.forEach(function (ingredient) {
        var key = normalizeName(ingredient.name);
        if (findByName(broadlineByName, ingredient.name)) return;
        if (findByName(recipeByName, ingredient.name)) return;
        addTotal(totals, ingredient.name, ingredient.pounds, recipe.name);
      });
    });
    var purchases = Object.keys(totals).map(function (key) { return totals[key]; });
    purchases.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    return {
      cookDate: cookDateFrom(text),
      broadline: broadline,
      recipes: recipes,
      purchases: purchases
    };
  }

  function purchaseByName(parsed, name) {
    var key = normalizeName(name);
    var found = null;
    (parsed.purchases || []).forEach(function (row) {
      if (normalizeName(row.name) === key) found = row;
    });
    return found;
  }

  return {
    normalizeName: normalizeName,
    nameKey: nameKey,
    parseScaledRecipes: parseScaledRecipes,
    purchaseByName: purchaseByName
  };
});
