const test = require('node:test');
const assert = require('node:assert/strict');
const cost = require('./transfer-cost.js');

const locations = [
  { id: 'colonnade', kind: 'case', label: 'Colonnade case' },
  { id: 'colonnade_backstock', kind: 'backstock', label: 'Colonnade backstock' },
  { id: 'rim', kind: 'case', label: 'Rim case' }
];

test('the week runs Thursday through Wednesday in Chicago, including the daylight-saving change', () => {
  const week = cost.transferWeek(new Date('2026-10-15T15:00:00.000Z'));
  assert.equal(new Date(week.start).toISOString(), '2026-10-15T05:00:00.000Z');
  assert.equal(new Date(week.end).toISOString(), '2026-10-22T05:00:00.000Z');
  assert.equal(week.label, 'Thu Oct 15 – Wed Oct 21');
  assert.equal(cost.transferWeek(new Date('2026-10-22T04:00:00.000Z')).label, week.label);
  assert.equal(cost.transferWeek(new Date('2026-10-22T05:30:00.000Z')).label, 'Thu Oct 22 – Wed Oct 28');

  const crossing = cost.transferWeek(new Date('2026-11-02T18:00:00.000Z'));
  assert.equal(new Date(crossing.start).toISOString(), '2026-10-29T05:00:00.000Z');
  assert.equal(new Date(crossing.end).toISOString(), '2026-11-05T06:00:00.000Z');
  assert.equal(crossing.label, 'Thu Oct 29 – Wed Nov 4');
  assert.equal(cost.shiftWeek(week, 1).label, 'Thu Oct 22 – Wed Oct 28');
  assert.equal(cost.shiftWeek(week, -1).label, 'Thu Oct 8 – Wed Oct 14');
});

test('meals sent to a case include tray, film, gas, and product, and leave labor out', () => {
  const week = cost.transferWeek(new Date('2026-10-16T15:00:00.000Z'));
  const summary = cost.summarize([
    {
      timestamp: new Date('2026-10-16T15:00:00.000Z').getTime(),
      to: 'rim',
      items: [{ dishName: 'Picadillo', qty: 10 }]
    },
    {
      timestamp: new Date('2026-10-21T22:00:00.000Z').getTime(),
      to: 'colonnade_backstock',
      items: [{ dishName: 'Picadillo', qty: 99 }]
    },
    {
      kind: 'split',
      timestamp: new Date('2026-10-18T15:00:00.000Z').getTime(),
      items: [{
        dishName: 'Picadillo',
        allocations: [
          { id: 'colonnade', name: 'Colonnade', caseQty: 20, backstock: 40 },
          { id: 'rim', name: 'Rim', caseQty: 8, backstock: 5 }
        ]
      }, {
        dishName: 'Orange Chicken',
        allocations: [{ id: 'rim', name: 'Rim', caseQty: 4, backstock: 0 }]
      }]
    },
    {
      timestamp: new Date('2026-10-22T12:00:00.000Z').getTime(),
      to: 'rim',
      items: [{ dishName: 'Picadillo', qty: 50 }]
    },
    {
      timestamp: new Date('2026-10-17T15:00:00.000Z').getTime(),
      to: 'rim',
      labor: 80,
      items: [{ dishName: 'Orange Chicken', qty: 2 }]
    }
  ], {
    tray: '0.40',
    film: 0.08,
    gas: '$0.05',
    labor: 12,
    product: { Picadillo: 3.25, 'Orange Chicken': '4.00' }
  }, locations, week);

  assert.equal(summary.laborIncluded, false);
  assert.equal(summary.tray, 0.4);
  assert.equal(summary.film, 0.08);
  assert.equal(summary.gas, 0.05);
  const rim = summary.cases.find(row => row.id === 'rim');
  const pic = rim.lines.find(line => line.dish === 'Picadillo');
  const orange = rim.lines.find(line => line.dish === 'Orange Chicken');
  assert.equal(pic.qty, 18);
  assert.equal(pic.how, 'Split, transfer');
  assert.equal(pic.packaging, 9.54);
  assert.equal(pic.productTotal, 58.5);
  assert.equal(pic.sent, 68.04);
  assert.equal(orange.qty, 6);
  assert.equal(orange.sent, 27.18);
  const colonnade = summary.cases.find(row => row.id === 'colonnade');
  assert.equal(colonnade.lines[0].qty, 20);
  assert.equal(colonnade.lines[0].how, 'Split');
  assert.equal(summary.cases.some(row => row.id === 'colonnade_backstock'), false);
  assert.equal(summary.meals, 44);
  assert.equal(summary.missing, 0);
  const html = cost.reportHtml(summary);
  assert.match(html, /Labor is not included/);
  assert.match(html, /\$68\.04/);
  assert.equal(html.includes('Labor $'), false);
});

test('a missing product cost is left blank instead of treated as zero', () => {
  const week = cost.transferWeek(new Date('2026-10-16T15:00:00.000Z'));
  const summary = cost.summarize([
    { timestamp: week.start + 1000, to: 'rim', items: [{ dishName: 'Picadillo', qty: 2 }] }
  ], { tray: 0.5, film: 0, gas: 0, product: {} }, locations, week);
  const line = summary.cases[0].lines[0];
  assert.equal(line.productMissing, true);
  assert.equal(line.sent, null);
  assert.equal(line.packaging, 1);
  assert.equal(summary.sent, 0);
  assert.equal(summary.missing, 1);
  assert.match(cost.reportHtml(summary), /data-product-dish="Picadillo"/);
  assert.match(cost.reportHtml(summary), /still need a product cost/);
});
