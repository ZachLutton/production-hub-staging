// Browser half of the recipe import. pdf.js reads the file; the parser is the same module
// a later automated pull can call with extracted text.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedRecipePdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function recipeApi() {
    if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
      try { return require('./recipe-parse.js'); } catch (e) { /* browser */ }
    }
    return typeof globalThis !== 'undefined' ? globalThis.ZedRecipe : null;
  }

  function layoutFromItems(items) {
    var rows = [];
    (items || []).forEach(function (item) {
      var text = String(item.str || '');
      if (!text) return;
      var y = Math.round(item.transform[5]);
      var placed = null;
      for (var i = 0; i < rows.length; i++) {
        if (Math.abs(rows[i].y - y) <= 2) { placed = rows[i]; break; }
      }
      if (!placed) {
        placed = { y: y, parts: [] };
        rows.push(placed);
      }
      placed.parts.push({ x: item.transform[4], text: text });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (row) {
      row.parts.sort(function (a, b) { return a.x - b.x; });
      var line = '';
      var lastX = null;
      row.parts.forEach(function (part) {
        if (lastX != null && part.x - lastX > 12) line += '  ';
        line += part.text;
        lastX = part.x + (part.text.length * 4);
      });
      return line;
    }).join('\n');
  }

  function parseRecipePdf(data, onProgress) {
    var pdfjs = typeof globalThis !== 'undefined' ? globalThis.pdfjsLib : null;
    function report(info) { if (typeof onProgress === 'function') onProgress(info); }
    if (!pdfjs || !pdfjs.getDocument) return Promise.reject(new Error('The PDF reader did not load. Check the connection and try again.'));
    report({ phase: 'open' });
    return pdfjs.getDocument({ data: data }).promise.then(function (doc) {
      var chain = Promise.resolve('');
      report({ phase: 'pages', pages: doc.numPages });
      for (var pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        (function (n) {
          chain = chain.then(function (text) {
            report({ phase: 'page', page: n, pages: doc.numPages });
            return doc.getPage(n).then(function (page) {
              return page.getTextContent().then(function (content) {
                return text + '\n' + layoutFromItems(content.items);
              });
            });
          });
        })(pageNumber);
      }
      return chain;
    }).then(function (text) {
      report({ phase: 'parse' });
      var parsed = recipeApi().parseScaledRecipes(text);
      report({ phase: 'done', ingredients: (parsed.purchases || []).length });
      return parsed;
    });
  }

  return { layoutFromItems: layoutFromItems, parseRecipePdf: parseRecipePdf };
});
