const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const done = require('./rim-count-done.js');

test('a Rim completion names the delivery Saturday and the cook Wednesday', () => {
  const message = done.renderCompletion({
    counted: 34,
    total: 34,
    blank: []
  }, '2026-12-02');
  assert.equal(message.includes('<@' + done.ZACH_SLACK_ID + '>'), true);
  assert.equal(message.includes('BEK delivery Sat 11/28'), true);
  assert.equal(message.includes('production Wed 12/2'), true);
  assert.equal(message.includes('34 of 34 par items counted.'), true);
  const withBlank = done.renderCompletion({
    counted: 32,
    total: 34,
    blank: ['Gloves', 'Film']
  }, '2026-12-02');
  assert.equal(withBlank.includes('Blank: Gloves, Film'), true);
});

test('only an unposted completion is ready to send', () => {
  const pending = done.pendingCompletions({
    rim: {
      '2026-12-02': { counted: 34, total: 34, blank: [], posted: false },
      '2026-11-25': { counted: 10, total: 34, blank: ['Soap'], posted: true }
    }
  });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].weekKey, '2026-12-02');
  assert.equal(done.STAGING_DATABASE.includes('zedops-staging'), true);
  assert.equal(done.STAGING_DATABASE.includes(done.LIVE_PROJECT), false);
});

test('the staging reminder has no schedule and the completion check stays on staging', () => {
  const root = path.join(__dirname, '..', '.github', 'workflows');
  const reminder = fs.readFileSync(path.join(root, 'rim-reminder-staging.yml'), 'utf8');
  const ping = fs.readFileSync(path.join(root, 'rim-count-done-staging.yml'), 'utf8');
  assert.equal(reminder.includes('workflow_dispatch'), true);
  assert.equal(/^\s*schedule:/m.test(reminder), false);
  assert.equal(reminder.includes('cron:'), false);
  assert.equal(reminder.includes('production-hub-staging'), true);
  assert.equal(reminder.includes('ZachLutton/production-hub\''), false);
  assert.equal(reminder.includes('?store=rim'), true);
  assert.equal(/pin/i.test(reminder), false);
  assert.equal(ping.includes('workflow_dispatch'), true);
  assert.equal(ping.includes('cron:'), true);
  assert.equal(ping.includes('rim-count-done.js'), true);
  const script = fs.readFileSync(path.join(__dirname, 'rim-count-done.js'), 'utf8');
  assert.equal(script.includes('zedops-staging'), true);
  assert.equal(script.includes('zedrics-production-hub-default-rtdb'), false);
  assert.equal(ping.includes('zedrics-production-hub'), false);
  assert.equal(ping.includes('secrets.ZEDOPS_STAGING_SERVICE_ACCOUNT'), true);
  assert.equal(ping.includes('secrets.SLACK_DONE_WEBHOOK_URL'), true);
  assert.equal(ping.includes('secrets.SLACK_WEBHOOK_URL'), false);
  assert.equal(ping.includes('FIREBASE_SERVICE_ACCOUNT'), false);
  assert.equal(script.includes('process.env.SLACK_DONE_WEBHOOK_URL'), true);
  assert.equal(script.includes('process.env.SLACK_WEBHOOK_URL'), false);
  assert.equal(script.includes('process.env.ZEDOPS_STAGING_SERVICE_ACCOUNT'), true);
  assert.equal(script.includes('FIREBASE_SERVICE_ACCOUNT'), false);
});
