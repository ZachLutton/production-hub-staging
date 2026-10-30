const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const pages = ['bek-count.html', 'bek-combined.html', 'weekly-order.html', 'monthly-inventory.html', 'dashboard.html'];
const siteRoot = path.join(__dirname, '..');

function checkSyntax() {
  ['catalog.js', 'schema.js', 'locations.js', 'storage.js', 'weekly-hidden.js', 'xlsx.js', 'pdf.js', 'price-overlay.js', 'bek.js', 'count-page.js', 'combined-page.js'].forEach(function (file) {
    execFileSync(process.execPath, ['--check', path.join(__dirname, file)]);
  });
}

function startServer() {
  const server = http.createServer(function (req, res) {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.normalize(path.join(siteRoot, relative));
    if (!file.startsWith(siteRoot)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, function (err, data) {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      const ext = path.extname(file);
      const types = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
      res.end(data);
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port });
    });
  });
}

function loadPage(port, page) {
  return new Promise(function (resolve, reject) {
    const chrome = spawn('google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu',
      '--virtual-time-budget=8000', '--timeout=20000',
      '--dump-dom', 'http://127.0.0.1:' + port + '/' + page
    ]);
    let out = '';
    let err = '';
    const timer = setTimeout(function () { chrome.kill('SIGKILL'); }, 20000);
    chrome.stdout.on('data', function (buf) {
      out += buf;
      if (out.includes('</html>')) chrome.kill('SIGKILL');
    });
    chrome.stderr.on('data', function (buf) { err += buf; });
    chrome.on('close', function () { clearTimeout(timer); resolve({ out: out, err: err }); });
    chrome.on('error', reject);
  });
}

test('changed pages load in a headless browser', { timeout: 120000 }, async () => {
  checkSyntax();
  const server = await startServer();
  try {
    for (const page of pages) {
      const result = await loadPage(server.port, page);
      assert.equal(result.out.includes('id="pin-input"'), true, page + ' login');
      assert.equal(result.out.includes('STAGING'), true, page + ' staging mark');
      assert.equal(result.out.includes('Staging will not start'), false, page);
      assert.equal(/Uncaught|SyntaxError|is not defined/.test(result.err), false, page + '\n' + result.err.slice(-1500));
    }
  } finally {
    server.server.close();
  }
});
