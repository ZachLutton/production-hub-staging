// Posts a new Rim "Done counting" record to Slack once, then marks it posted.
// Reads staging Firebase only. The live project is refused.
//
// Pure helpers are exported for scripts/rim-count-done.test.js.

const https = require('https');
const { URL } = require('url');
const bek = require('../zedops/bek.js');

const ZACH_SLACK_ID = 'U02KLAS8S';
const LIVE_PROJECT = 'zedrics-production-hub';
const STAGING_DATABASE = 'https://zedops-staging-default-rtdb.firebaseio.com';
const DONE_PATH = 'staging_zedops_count_done';

function pendingCompletions(tree) {
  const found = [];
  Object.keys(tree || {}).forEach(function (loc) {
    Object.keys(tree[loc] || {}).forEach(function (week) {
      const row = tree[loc][week];
      if (!row || typeof row !== 'object' || row.posted) return;
      found.push({ locationId: loc, weekKey: week, record: row });
    });
  });
  return found;
}

function renderCompletion(record, weekKey) {
  const cycle = bek.cycleForCook(weekKey);
  const delivery = bek.shortDate(cycle.delivery);
  const cook = bek.shortDate(cycle.cook);
  const counted = Number(record && record.counted) || 0;
  const total = Number(record && record.total) || 0;
  const lines = [
    '<@' + ZACH_SLACK_ID + '> Rim inventory entered for BEK delivery ' + delivery
      + ' (production ' + cook + '). ' + counted + ' of ' + total + ' par items counted.'
  ];
  const blank = record && Array.isArray(record.blank) ? record.blank.filter(Boolean) : [];
  if (blank.length) lines.push('Blank: ' + blank.join(', '));
  return lines.join('\n');
}

function postToSlack(webhookUrl, text) {
  return new Promise(function (resolve, reject) {
    const parsed = new URL(webhookUrl);
    const data = JSON.stringify({ text: text });
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, function (res) {
      let body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        if (res.statusCode === 200) resolve(body);
        else reject(new Error('Slack returned ' + res.statusCode + ': ' + body));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function publishPending(db, webhookUrl) {
  const snap = await db.ref(DONE_PATH).once('value');
  const pending = pendingCompletions(snap.val());
  const posted = [];
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const ref = db.ref(DONE_PATH + '/' + item.locationId + '/' + item.weekKey);
    const claim = await ref.transaction(function (current) {
      if (!current || current.posted) return;
      const next = Object.assign({}, current, { posted: true, postedAt: Date.now() });
      return next;
    });
    if (!claim.committed) continue;
    const message = renderCompletion(claim.snapshot.val(), item.weekKey);
    try {
      await postToSlack(webhookUrl, message);
      posted.push(item.locationId + '/' + item.weekKey);
    } catch (err) {
      await ref.update({ posted: false });
      throw err;
    }
  }
  return posted;
}

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (serviceAccount.project_id === LIVE_PROJECT) {
    throw new Error('Refusing the live Firebase project.');
  }
  const admin = require('firebase-admin');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: STAGING_DATABASE
  });
  const posted = await publishPending(admin.database(), process.env.SLACK_WEBHOOK_URL);
  console.log(posted.length ? 'Posted ' + posted.join(', ') : 'No new Rim completion.');
}

module.exports = {
  pendingCompletions: pendingCompletions,
  renderCompletion: renderCompletion,
  ZACH_SLACK_ID: ZACH_SLACK_ID,
  STAGING_DATABASE: STAGING_DATABASE,
  LIVE_PROJECT: LIVE_PROJECT
};

if (require.main === module) {
  main().catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}
