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

  // Helvetica is the built-in stand-in for Lato or Open Sans. WinAnsi covers the em dash.
  function pdfString(text) {
    var s = String(text == null ? '' : text);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code === 0x2014) { out += '\\227'; continue; }
      if (code === 0x2013) { out += '\\226'; continue; }
      if (code === 0x00B7) { out += '\\267'; continue; }
      if (code === 0x2018 || code === 0x2019) { out += "'"; continue; }
      var ch = s.charAt(i);
      if (ch === '\\' || ch === '(' || ch === ')') { out += '\\' + ch; continue; }
      if (code < 32 || code > 126) continue;
      out += ch;
    }
    return out;
  }

  function wrapWidth(text, chars) {
    var words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
    var lines = [];
    var current = '';
    words.forEach(function (word) {
      var next = current ? current + ' ' + word : word;
      if (next.length > chars && current) {
        lines.push(current);
        current = word.length > chars ? word.slice(0, chars) : word;
      } else current = next;
    });
    if (current) lines.push(current);
    if (!lines.length) lines.push('');
    return lines;
  }

  // "12.5 lb", never "lb 12.5". A blank count stays blank, with no unit hanging on it.
  function amountThenUnit(amount, unit) {
    if (amount == null || amount === '') return '';
    var qty = String(amount);
    var word = String(unit || '').trim();
    if (!word) return qty;
    if (qty.slice(-word.length) === word) return qty;
    return qty + ' ' + word;
  }

  // Letter sheet with an orange header, section bands, and one row per item.
  // Portrait. Counts stay in the On hand column. Grams are that count's weight only.
  function buildSheetPdf(doc) {
    var title = String((doc && doc.title) || "Zedric's On-Hand Inventory");
    var subtitle = String((doc && doc.subtitle) || '');
    var generated = String((doc && doc.generated) || '');
    var sections = (doc && doc.sections) || [];
    var columns = [
      { key: 'number', label: 'BEK #', x: 28 },
      { key: 'name', label: 'Item', x: 74 },
      { key: 'pack', label: 'Pack', x: 196 },
      { key: 'onHand', label: 'On hand', x: 278 },
      { key: 'grams', label: 'Grams', x: 362 },
      { key: 'entered', label: 'Last entered', x: 458 }
    ];
    function columnX(key) {
      for (var i = 0; i < columns.length; i++) if (columns[i].key === key) return columns[i].x;
      return 28;
    }
    var blocks = [];
    sections.forEach(function (section) {
      blocks.push({ kind: 'section', text: section.title || 'Items' });
      (section.rows || []).forEach(function (row) {
        var nameLines = wrapWidth(row.name || '', 22);
        var packLines = wrapWidth(row.pack || '', 14);
        var enteredLines = wrapWidth(row.entered || '', 22);
        var handLines = wrapWidth(amountThenUnit(row.onHand, row.unit), 24);
        if (!row.pack) packLines = [''];
        if (!row.entered) enteredLines = [''];
        if (!handLines.length) handLines = [''];
        blocks.push({
          kind: 'row',
          lines: nameLines,
          packLines: packLines,
          enteredLines: enteredLines,
          handLines: handLines,
          cells: {
            number: row.number || '',
            name: nameLines,
            pack: packLines,
            onHand: handLines,
            grams: row.grams == null ? '' : String(row.grams),
            entered: enteredLines
          }
        });
      });
    });
    if (!blocks.length) blocks.push({ kind: 'section', text: 'No items on this sheet' });

    var pages = [];
    var current = [];
    var used = 0;
    var limit = 620;
    function blockHeight(block) {
      if (block.kind === 'section') return 20;
      var lines = Math.max(1, block.lines.length, (block.packLines || []).length, (block.enteredLines || []).length, (block.handLines || []).length);
      return 6 + lines * 11;
    }
    blocks.forEach(function (block) {
      var height = blockHeight(block);
      if (used + height > limit && current.length) {
        pages.push(current);
        current = [];
        used = 0;
      }
      current.push(block);
      used += height;
    });
    if (current.length) pages.push(current);
    if (!pages.length) pages.push([]);

    var objects = [];
    function add(body) {
      objects.push(body);
      return objects.length;
    }
    var regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    var bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    var pageIds = [];
    pages.forEach(function (blocksOnPage, pageIndex) {
      var cmds = [];
      cmds.push('0.949 0.396 0.129 rg');
      cmds.push('0 728 612 64 re f');
      cmds.push('BT /F2 11 Tf 1 1 1 rg 1 0 0 1 28 772 Tm (' + pdfString(title) + ') Tj ET');
      if (subtitle) cmds.push('BT /F2 9 Tf 1 1 1 rg 1 0 0 1 28 758 Tm (' + pdfString(subtitle) + ') Tj ET');
      cmds.push('BT /F1 8 Tf 1 1 1 rg 1 0 0 1 28 744 Tm (' + pdfString(generated) + ') Tj ET');
      cmds.push('0.25 0.25 0.25 rg');
      columns.forEach(function (col) {
        cmds.push('BT /F2 8 Tf 1 0 0 1 ' + col.x + ' 712 Tm (' + pdfString(col.label) + ') Tj ET');
      });
      cmds.push('0.85 0.85 0.85 RG 0.6 w 28 706 m 584 706 l S');
      var y = 692;
      blocksOnPage.forEach(function (block) {
        if (block.kind === 'section') {
          cmds.push('0.98 0.90 0.84 rg');
          cmds.push('28 ' + (y - 11) + ' 556 16 re f');
          cmds.push('BT /F2 9 Tf 0.55 0.22 0.08 rg 1 0 0 1 34 ' + (y - 6) + ' Tm (' + pdfString(block.text) + ') Tj ET');
          y -= 20;
          return;
        }
        cmds.push('0.1 0.1 0.1 rg');
        cmds.push('BT /F1 8 Tf 1 0 0 1 ' + columnX('number') + ' ' + y + ' Tm (' + pdfString(block.cells.number) + ') Tj ET');
        block.lines.forEach(function (line, index) {
          cmds.push('BT /F1 8 Tf 1 0 0 1 ' + columnX('name') + ' ' + (y - index * 11) + ' Tm (' + pdfString(line) + ') Tj ET');
        });
        (block.packLines || ['']).forEach(function (line, index) {
          cmds.push('BT /F1 8 Tf 1 0 0 1 ' + columnX('pack') + ' ' + (y - index * 11) + ' Tm (' + pdfString(line) + ') Tj ET');
        });
        (block.handLines || [typeof block.cells.onHand === 'string' ? block.cells.onHand : '']).forEach(function (line, index) {
          cmds.push('BT /F1 8 Tf 1 0 0 1 ' + columnX('onHand') + ' ' + (y - index * 11) + ' Tm (' + pdfString(line) + ') Tj ET');
        });
        if (block.cells.grams === 'no weight set') cmds.push('0.54 0.12 0.12 rg');
        cmds.push('BT /F1 8 Tf 1 0 0 1 ' + columnX('grams') + ' ' + y + ' Tm (' + pdfString(block.cells.grams) + ') Tj ET');
        cmds.push('0.1 0.1 0.1 rg');
        (block.enteredLines || ['']).forEach(function (line, index) {
          cmds.push('BT /F1 7 Tf 1 0 0 1 ' + columnX('entered') + ' ' + (y - index * 11) + ' Tm (' + pdfString(line) + ') Tj ET');
        });
        y -= blockHeight(block);
      });
      cmds.push('0.4 0.4 0.4 rg');
      cmds.push('BT /F1 8 Tf 1 0 0 1 480 28 Tm (' + pdfString('Page ' + (pageIndex + 1) + ' of ' + pages.length) + ') Tj ET');
      var stream = cmds.join('\n');
      var contentId = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      var pageId = add('<< /Type /Page /Parent PAGES /MediaBox [0 0 612 792] /Contents ' + contentId + ' 0 R /Resources << /Font << /F1 ' + regular + ' 0 R /F2 ' + bold + ' 0 R >> >> >>');
      pageIds.push(pageId);
    });
    var kids = pageIds.map(function (id) { return id + ' 0 R'; }).join(' ');
    var pagesId = add('<< /Type /Pages /Count ' + pageIds.length + ' /Kids [' + kids + '] >>');
    var catalogId = add('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
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

  return { buildPdf: buildPdf, buildSheetPdf: buildSheetPdf, downloadPdf: downloadPdf, escapePdf: escapePdf, pdfString: pdfString };
});
