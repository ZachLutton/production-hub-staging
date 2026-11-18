// Reads the first worksheet of an .xlsx file. Item-number cells are kept as text.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZedXlsx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function bytes(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    return new Uint8Array(input);
  }

  function u16(buf, offset) {
    return buf[offset] | (buf[offset + 1] << 8);
  }

  function u32(buf, offset) {
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
  }

  function inflateRaw(slice) {
    if (typeof require === 'function') {
      try {
        var zlib = require('zlib');
        return Promise.resolve(new Uint8Array(zlib.inflateRawSync(Buffer.from(slice))));
      } catch (e) { /* fall through to the browser */ }
    }
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('This browser cannot read the spreadsheet.'));
    }
    var stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function unzip(input) {
    var buf = bytes(input);
    var files = {};
    var offset = 0;
    var chain = Promise.resolve();
    function take(entry) {
      chain = chain.then(function () { return entry; }).then(function (text) {
        files[text.name] = text.body;
      });
    }
    while (offset + 30 <= buf.length && u32(buf, offset) === 0x04034b50) {
      var method = u16(buf, offset + 8);
      var flags = u16(buf, offset + 6);
      var compSize = u32(buf, offset + 18);
      var nameLen = u16(buf, offset + 26);
      var extraLen = u16(buf, offset + 28);
      var name = String.fromCharCode.apply(null, buf.subarray(offset + 30, offset + 30 + nameLen));
      var dataStart = offset + 30 + nameLen + extraLen;
      if (flags & 0x8) return Promise.reject(new Error('This spreadsheet uses a zip format the reader does not support. Save it from Excel as .xlsx and try again.'));
      var slice = buf.subarray(dataStart, dataStart + compSize);
      offset = dataStart + compSize;
      (function (fileName, fileSlice, fileMethod) {
        take(function () {
          var body = fileMethod === 0 ? Promise.resolve(fileSlice) : inflateRaw(fileSlice);
          return body.then(function (raw) {
            return { name: fileName, body: new TextDecoder('utf-8').decode(raw) };
          });
        }());
      })(name, slice, method);
    }
    return chain.then(function () { return files; });
  }

  function decodeXml(text) {
    return String(text || '').replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  function sharedStrings(xml) {
    if (!xml) return [];
    var out = [];
    var parts = xml.split(/<si[\s>]/).slice(1);
    parts.forEach(function (part) {
      var texts = [];
      var re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      var match;
      while ((match = re.exec(part))) texts.push(decodeXml(match[1]));
      out.push(texts.join(''));
    });
    return out;
  }

  function columnIndex(ref) {
    var letters = String(ref || '').replace(/[0-9]/g, '');
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n;
  }

  function rowNumber(ref) {
    return Number(String(ref || '').replace(/[^0-9]/g, '')) || 0;
  }

  function sheetMatrix(xml, strings) {
    var rows = {};
    var re = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    var match;
    while ((match = re.exec(xml || ''))) {
      var attrs = match[1];
      var body = match[2];
      var ref = (/r="([^"]+)"/.exec(attrs) || [])[1] || '';
      var type = (/t="([^"]+)"/.exec(attrs) || [])[1] || '';
      var row = rowNumber(ref);
      var col = columnIndex(ref);
      if (!row || !col) continue;
      var value = '';
      if (type === 'inlineStr') {
        var inline = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
        value = inline ? decodeXml(inline[1]) : '';
      } else {
        var raw = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        if (raw == null) value = '';
        else if (type === 's') value = strings[Number(raw)] == null ? '' : strings[Number(raw)];
        else value = decodeXml(raw);
      }
      if (!rows[row]) rows[row] = {};
      rows[row][col] = value;
    }
    var numbers = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; });
    return numbers.map(function (n) {
      var cols = rows[n];
      var max = 0;
      Object.keys(cols).forEach(function (key) { max = Math.max(max, Number(key)); });
      var line = [];
      for (var i = 1; i <= max; i++) line.push(cols[i] == null ? '' : String(cols[i]));
      return line;
    });
  }

  function parseXlsx(input) {
    return unzip(input).then(function (files) {
      var sheetName = Object.keys(files).filter(function (name) { return /xl\/worksheets\/sheet1\.xml$/.test(name); })[0];
      if (!sheetName) throw new Error('No sheet was found in that file.');
      var sharedName = Object.keys(files).filter(function (name) { return /xl\/sharedStrings\.xml$/.test(name); })[0];
      return sheetMatrix(files[sheetName], sharedStrings(sharedName ? files[sharedName] : ''));
    });
  }

  return { parseXlsx: parseXlsx, sheetMatrix: sheetMatrix, sharedStrings: sharedStrings };
});
