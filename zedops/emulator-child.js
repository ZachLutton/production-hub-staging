// Runs inside the Firebase emulator (demo project only). Proves rules and concurrent item writes.
const assert = require('assert');
const storage = require('./storage.js');

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const dbHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const project = 'demo-bek-count-default-rtdb';
const password = 'emulator-only-not-a-pin';
const teamEmail = 'team@zedrics-production-hub.firebaseapp.com';
const adminEmail = 'admin@zedrics-production-hub.firebaseapp.com';

async function signUp(email) {
  const res = await fetch('http://' + authHost + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
  });
  const body = await res.json();
  if (!res.ok) throw new Error('sign-up failed: ' + JSON.stringify(body));
  return body.idToken;
}

function dbUrl(path, token) {
  const url = 'http://' + dbHost + '/' + path + '.json?ns=' + project;
  return token ? url + '&auth=' + encodeURIComponent(token) : url;
}

async function put(token, path, value) {
  const res = await fetch(dbUrl(path, token), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  const text = await res.text();
  return { status: res.status, text: text };
}

async function get(token, path) {
  const res = await fetch(dbUrl(path, token));
  const text = await res.text();
  return { status: res.status, text: text };
}

async function main() {
  if (!authHost || !dbHost) throw new Error('Emulator hosts were not set.');
  const team = await signUp(teamEmail);
  const admin = await signUp(adminEmail);
  const outsider = await signUp('outsider@example.com');
  const week = '2026-10-27';
  const lemon = storage.countPath('store-a', week, 'bek__111');
  const oil = storage.countPath('store-a', week, 'bek__222');
  const other = storage.countPath('store-b', week, 'bek__111');

  const denied = await put(null, lemon, 1);
  assert.notEqual(denied.status, 200, 'signed-out write should fail: ' + denied.text);
  const outsiderWrite = await put(outsider, lemon, 1);
  assert.notEqual(outsiderWrite.status, 200, 'other account should fail: ' + outsiderWrite.text);

  const saved = await Promise.all([
    put(team, lemon, 1.25),
    put(admin, oil, 4),
    put(team, other, 9)
  ]);
  saved.forEach(function (result) {
    assert.equal(result.status, 200, result.text);
  });
  const weekRead = await get(admin, 'staging_zedops_counts/store-a/' + week);
  assert.equal(weekRead.status, 200, weekRead.text);
  const weekBody = JSON.parse(weekRead.text);
  assert.equal(weekBody.bek__111, 1.25);
  assert.equal(weekBody.bek__222, 4);
  const otherRead = await get(team, other);
  assert.equal(JSON.parse(otherRead.text), 9);

  const par = await put(admin, 'staging_zedops_pars/store-a/bek__111', { value: 2, unit: 'gallon' });
  assert.equal(par.status, 200, par.text);
  const hidden = await put(team, 'staging_zedops_hidden/store-a/bek__222', true);
  assert.equal(hidden.status, 200, hidden.text);
  console.log('Emulator rules and concurrent item writes passed.');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
