const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const firebaseBin = process.env.FIREBASE_BIN || '/tmp/zedops-fb/node_modules/.bin/firebase';

test('emulator: concurrent counts and staging rules on a demo project', { timeout: 180000 }, (t) => {
  if (!fs.existsSync(firebaseBin)) {
    t.skip('Set FIREBASE_BIN to the Firebase CLI to run the demo-bek-count emulator.');
    return;
  }
  const dir = fs.mkdtempSync('/tmp/zedops-emulator-');
  fs.copyFileSync(path.join(__dirname, '..', 'database.rules.staging.json'), path.join(dir, 'database.rules.staging.json'));
  fs.writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({
    database: { rules: 'database.rules.staging.json' },
    emulators: {
      auth: { port: 9159 },
      database: { port: 9150 },
      ui: { enabled: false },
      hub: { port: 4459 }
    }
  }));
  return new Promise(function (resolve, reject) {
    const child = spawn(firebaseBin, [
      'emulators:exec',
      '--only', 'auth,database',
      '--project', 'demo-bek-count',
      '--config', path.join(dir, 'firebase.json'),
      'node ' + path.join(__dirname, 'emulator-child.js')
    ], { cwd: dir, env: Object.assign({}, process.env, { NODE_PATH: path.join(__dirname) }) });
    let out = '';
    child.stdout.on('data', function (buf) { out += buf; });
    child.stderr.on('data', function (buf) { out += buf; });
    child.on('error', reject);
    child.on('close', function (code) {
      if (code === 0 && out.includes('Emulator rules and concurrent item writes passed.')) resolve();
      else reject(new Error('emulator test failed (' + code + ')\n' + out.slice(-4000)));
    });
  });
});
