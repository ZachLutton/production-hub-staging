// Browser half of the plate-list import. pdf.js reads the file; the parser stays separate.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedPlatePdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function plateApi() {
    if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
      try { return require('./plate-parse.js'); } catch (e) { /* browser */ }
    }
    return typeof globalThis !== 'undefined' ? globalThis.ZedPlate : null;
  }

  function layoutApi() {
    if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
      try { return require('./recipe-pdf.js'); } catch (e) { /* browser */ }
    }
    return typeof globalThis !== 'undefined' ? globalThis.ZedRecipePdf : null;
  }

  function parsePlatePdf(data, onProgress) {
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
                return text + '\n' + layoutApi().layoutFromItems(content.items);
              });
            });
          });
        })(pageNumber);
      }
      return chain;
    }).then(function (text) {
      report({ phase: 'parse' });
      var parsed = plateApi().parsePlateList(text);
      report({ phase: 'done', totalCook: parsed.totalCook });
      return parsed;
    });
  }

  return { parsePlatePdf: parsePlatePdf };
});
