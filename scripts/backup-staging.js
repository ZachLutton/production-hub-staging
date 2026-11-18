// Backup ZedOps Staging before a deploy.
// Same envelope as scripts/backup-db.js (exportedAt, databaseURL, counts, rules, data).
// This file refuses the live Production Hub. It does not deploy anything.
const fs = require('fs');
const path = require('path');

function liveId() {
  return ['zedrics', 'production-hub'].join('-');
}

function countLeaves(value) {
  if (value === null || typeof value !== 'object') return 1;
  return Object.values(value).reduce(function (sum, child) { return sum + countLeaves(child); }, 0);
}

function assertStagingTarget(databaseURL, projectId) {
  const blob = (String(databaseURL || '') + ' ' + String(projectId || '')).toLowerCase();
  if (!String(databaseURL || '').trim()) {
    throw new Error('No staging database URL. This script will not guess, and it will not use the live project.');
  }
  if (blob.includes(liveId())) throw new Error('Refusing to back up the live Production Hub.');
  return String(databaseURL).trim();
}

function readConfig() {
  const file = path.join(__dirname, '..', 'firebase-config.js');
  const text = fs.readFileSync(file, 'utf8');
  function pick(name) {
    const match = new RegExp(name + ':\\s*"([^"]*)"').exec(text);
    return match ? match[1] : '';
  }
  return { projectId: pick('projectId'), databaseURL: pick('databaseURL') };
}

function buildEnvelope({ databaseURL, projectId, data, rules, exportedAt }) {
  const url = assertStagingTarget(databaseURL, projectId);
  const body = data || {};
  const counts = {};
  Object.keys(body).sort().forEach(function (key) {
    const value = body[key];
    counts[key] = {
      children: value && typeof value === 'object' ? Object.keys(value).length : 0,
      leaves: countLeaves(value)
    };
  });
  return {
    exportedAt: exportedAt || new Date().toISOString(),
    databaseURL: url,
    projectId: projectId || '',
    counts: counts,
    totalLeaves: countLeaves(body),
    rules: rules == null ? null : rules,
    data: body
  };
}

function check() {
  const live = liveId();
  let refusedEmpty = false;
  let refusedLive = false;
  try { assertStagingTarget('', ''); } catch (e) { refusedEmpty = true; }
  try { assertStagingTarget('https://' + live + '-default-rtdb.firebaseio.com', ''); } catch (e) { refusedLive = true; }
  if (!refusedEmpty || !refusedLive) throw new Error('Backup guard failed.');
  const config = readConfig();
  assertStagingTarget(config.databaseURL, config.projectId);
  console.log('Staging backup check passed. Live project was refused. Nothing was exported.');
}

async function main() {
  if (process.argv.includes('--check')) {
    check();
    return;
  }
  const admin = require('firebase-admin');
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT to the ZedOps Staging service account. This script will not fall back to another project.');
  }
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const config = readConfig();
  const databaseURL = process.env.ZEDOPS_STAGING_DATABASE_URL || config.databaseURL;
  const projectId = serviceAccount.project_id || config.projectId;
  assertStagingTarget(databaseURL, projectId);
  if (String(serviceAccount.project_id || '') && String(serviceAccount.project_id).toLowerCase().includes(liveId())) {
    throw new Error('Refusing to back up the live Production Hub.');
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: databaseURL });
  const db = admin.database();
  const data = (await db.ref('/').once('value')).val() || {};
  let rules = null;
  try { rules = await db.getRules(); } catch (e) { console.log('Could not read rules:', e.message); }
  const out = buildEnvelope({ databaseURL: databaseURL, projectId: projectId, data: data, rules: rules });
  const dest = path.join(process.cwd(), 'backup-staging.json');
  fs.writeFileSync(dest, JSON.stringify(out));
  console.log('Exported at', out.exportedAt);
  console.log('Top-level nodes:', JSON.stringify(out.counts));
  console.log('Total values:', out.totalLeaves, '| rules saved:', rules !== null, '| bytes:', fs.statSync(dest).size);
  console.log('Next, encrypt it with scripts/backup-public-cert.pem and delete backup-staging.json. See docs/zedops.md.');
}

module.exports = { assertStagingTarget, buildEnvelope, countLeaves, readConfig, liveId };

if (require.main === module) {
  main().then(function () { process.exit(0); }).catch(function (err) {
    console.error('Staging backup failed:', err.message);
    process.exit(1);
  });
}
