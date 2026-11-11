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
    const chromeDir = fs.mkdtempSync('/tmp/zedops-chrome-dump-');
    const chrome = spawn('google-chrome', [
      '--headless=new', '--no-sandbox', '--disable-gpu',
      '--user-data-dir=' + chromeDir,
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
      if (page === 'bek-count.html' || page === 'bek-combined.html') {
        assert.equal(result.out.includes('weekly-order.html') || result.out.includes('Weekly Order'), true, page + ' redirect');
        continue;
      }
      assert.equal(result.out.includes('id="pin-input"'), true, page + ' login');
      assert.equal(result.out.includes('STAGING'), true, page + ' staging mark');
      assert.equal(result.out.includes('Staging will not start'), false, page);
      assert.equal(/Uncaught|SyntaxError|is not defined/.test(result.err), false, page + '\n' + result.err.slice(-1500));
    }
  } finally {
    server.server.close();
  }
});

test('the store and order buttons switch the visible list', { timeout: 60000 }, async () => {
  const server = await startServer();
  const chromeDir = fs.mkdtempSync('/tmp/zedops-chrome-');
  const chrome = spawn('google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--user-data-dir=' + chromeDir,
    '--remote-debugging-port=9341', '--remote-debugging-address=127.0.0.1',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let debugError = '';
  chrome.stderr.on('data', function (buf) { debugError += buf; });
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  try {
    let list = null;
    for (let i = 0; i < 30 && !list; i++) {
      await sleep(200);
      try { list = await fetch('http://127.0.0.1:9341/json/list').then(function (res) { return res.json(); }); } catch (e) {}
    }
    assert.ok(list, 'Chrome did not open a debug port\n' + debugError.slice(-500));
    const page = list.find(function (tab) { return tab.type === 'page' && tab.webSocketDebuggerUrl; });
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    const logs = [];
    ws.addEventListener('message', function (ev) {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Runtime.exceptionThrown') {
        const detail = msg.params.exceptionDetails;
        logs.push(detail.text + ' ' + (detail.exception && detail.exception.description));
      }
    });
    function send(method, params) {
      const id = ++seq;
      return new Promise(function (resolve) {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id: id, method: method, params: params }));
      });
    }
    await new Promise(function (resolve) { ws.addEventListener('open', resolve); });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:' + server.port + '/weekly-order.html' });
    await sleep(2000);
    const evaluated = await send('Runtime.evaluate', {
      expression: "(() => { const snap = () => ({ store: document.getElementById('storeView').style.display, order: document.getElementById('orderView').style.display, pressed: document.getElementById('showOrder').getAttribute('aria-pressed') }); const before = snap(); document.getElementById('showOrder').click(); const afterOrder = snap(); document.getElementById('showStore').click(); const afterStore = snap(); return JSON.stringify({ before, afterOrder, afterStore }); })()",
      returnByValue: true
    });
    const value = evaluated.result && evaluated.result.result && evaluated.result.result.value;
    assert.equal(logs.filter(function (line) { return /SyntaxError|is not defined|Uncaught/.test(line); }).join('\n'), '');
    const body = JSON.parse(value);
    assert.equal(body.afterOrder.order, 'block', JSON.stringify(body));
    assert.equal(body.afterOrder.store, 'none', JSON.stringify(body));
    assert.equal(body.afterOrder.pressed, 'true');
    assert.equal(body.afterStore.store, 'block');
    assert.equal(body.afterStore.order, 'none');
    assert.equal(body.afterStore.pressed, 'false');
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    server.server.close();
  }
});
