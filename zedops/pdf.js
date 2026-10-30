// Small text PDF. No extra library, so the count can be downloaded on the staging site.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedPdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function escapePdf(text) {
    return String(text == null ? '' : text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function wrap(text, width) {
    var words = String(text == null ? '' : text).split(/\s+/);
    var lines = [];
    var current = '';
    words.forEach(function (word) {
      if (!word) return;
      var next = current ? current + ' ' + word : word;
      if (next.length > width && current) {
        lines.push(current);
        current = word;
      } else current = next;
    });
    if (current) lines.push(current);
    if (!lines.length) lines.push('');
    return lines;
  }

  function buildPdf(doc) {
    var title = String((doc && doc.title) || 'ZedOps');
    var rawLines = (doc && doc.lines) || [];
    var wrapped = [];
    wrapped.push(title);
    wrapped.push('');
    rawLines.forEach(function (line) {
      wrap(line, 95).forEach(function (part) { wrapped.push(part); });
    });
    var perPage = 46;
    var pages = [];
    for (var i = 0; i < wrapped.length; i += perPage) pages.push(wrapped.slice(i, i + perPage));
    if (!pages.length) pages.push(['']);

    var objects = [];
    function add(body) {
      objects.push(body);
      return objects.length;
    }

    var fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    var pageIds = [];
    pages.forEach(function (lines) {
      var content = ['BT', '/F1 10 Tf', '48 750 Td', '14 TL'];
      lines.forEach(function (line, index) {
        var size = index === 0 && line === title ? 14 : 10;
        if (index === 0 && line === title) content.push('/F1 14 Tf');
        content.push('(' + escapePdf(line) + ') Tj');
        content.push('T*');
        if (index === 0 && line === title) content.push('/F1 10 Tf');
      });
      content.push('ET');
      var stream = content.join('\n');
      var contentId = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      var pageId = add('<< /Type /Page /Parent PAGES /MediaBox [0 0 612 792] /Contents ' + contentId + ' 0 R /Resources << /Font << /F1 ' + fontId + ' 0 R >> >> >>');
      pageIds.push(pageId);
    });
    var kids = pageIds.map(function (id) { return id + ' 0 R'; }).join(' ');
    var pagesId = add('<< /Type /Pages /Count ' + pageIds.length + ' /Kids [' + kids + '] >>');
    var catalogId = add('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
    objects[pagesId - 1] = objects[pagesId - 1];
    objects = objects.map(function (body) { return body.replace('Parent PAGES', 'Parent ' + pagesId + ' 0 R'); });

    var out = '%PDF-1.4\n';
    var offsets = [0];
    objects.forEach(function (body, index) {
      offsets.push(out.length);
      out += (index + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });
    var xref = out.length;
    out += 'xref\n0 ' + (objects.length + 1) + '\n';
    out += '0000000000 65535 f \n';
    for (var n = 1; n <= objects.length; n++) {
      out += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
    }
    out += 'trailer << /Size ' + (objects.length + 1) + ' /Root ' + catalogId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    var bytes = new Uint8Array(out.length);
    for (var c = 0; c < out.length; c++) bytes[c] = out.charCodeAt(c) & 0xff;
    return bytes;
  }

  function downloadPdf(filename, bytes) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  return { buildPdf: buildPdf, downloadPdf: downloadPdf, escapePdf: escapePdf };
});
