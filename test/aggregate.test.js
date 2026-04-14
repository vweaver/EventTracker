// test/aggregate.test.js — exhaustive boundary coverage for the
// pure bucket math. See TECH_SPEC.md "Testing → aggregate.test.js"
// and PRD.md "Time Blocks".

import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf, aggregate, bucketKey } from '../aggregate.js';

// Use constructed Dates so we don't depend on tz-string parsing.
function at(y, m, d, h, min = 0, s = 0) {
  return new Date(y, m - 1, d, h, min, s);
}

test('bucketOf: 08:59:59 → block 0', () => {
  assert.equal(bucketOf(at(2026, 4, 13, 8, 59, 59)).block, 0);
});

test('bucketOf: 09:00:00 → block 1 (half-open boundary)', () => {
  assert.equal(bucketOf(at(2026, 4, 13, 9, 0, 0)).block, 1);
});

test('bucketOf: 11:59:59 → block 1', () => {
  assert.equal(bucketOf(at(2026, 4, 13, 11, 59, 59)).block, 1);
});

test('bucketOf: 12:00:00 → block 2', () => {
  assert.equal(bucketOf(at(2026, 4, 13, 12, 0, 0)).block, 2);
});

test('bucketOf: 16:59:59 → block 2', () => {
  assert.equal(bucketOf(at(2026, 4, 13, 16, 59, 59)).block, 2);
});

test('bucketOf: 17:00:00 → block 3', () => {
  assert.equal(bucketOf(at(2026, 4, 13, 17, 0, 0)).block, 3);
});

test('bucketOf: 23:59:59 → block 3', () => {
  assert.equal(bucketOf(at(2026, 4, 13, 23, 59, 59)).block, 3);
});

test('bucketOf: 00:00:00 → block 0', () => {
  assert.equal(bucketOf(at(2026, 4, 13, 0, 0, 0)).block, 0);
});

test('bucketOf: day-of-week mapping Sun=0..Sat=6', () => {
  // 2026-04-12 is a Sunday; walk forward 7 days.
  const expected = [0, 1, 2, 3, 4, 5, 6];
  for (let i = 0; i < 7; i++) {
    const d = at(2026, 4, 12 + i, 10); // block 1 doesn't matter
    assert.equal(bucketOf(d).dow, expected[i], `offset ${i}`);
  }
});

test('aggregate([]) → 28 keys, all total=0 and p=null', () => {
  const agg = aggregate([]);
  assert.equal(agg.size, 28);
  for (let dow = 0; dow < 7; dow++) {
    for (let block = 0; block < 4; block++) {
      const cell = agg.get(bucketKey(dow, block));
      assert.ok(cell, `missing ${dow},${block}`);
      assert.equal(cell.total, 0);
      assert.equal(cell.positive, 0);
      assert.equal(cell.p, null);
    }
  }
});

test('aggregate: fully-positive bucket → p === 1', () => {
  const events = [
    { timestamp: at(2026, 4, 15, 10).toString(), value: 1 }, // Wed, block 1
    { timestamp: at(2026, 4, 15, 11).toString(), value: 1 },
  ];
  const agg = aggregate(events);
  const cell = agg.get(bucketKey(3, 1));
  assert.equal(cell.total, 2);
  assert.equal(cell.positive, 2);
  assert.equal(cell.p, 1);
});

test('aggregate: fully-negative bucket → p === 0', () => {
  const events = [
    { timestamp: at(2026, 4, 15, 10).toString(), value: 0 },
    { timestamp: at(2026, 4, 15, 11).toString(), value: 0 },
  ];
  const agg = aggregate(events);
  const cell = agg.get(bucketKey(3, 1));
  assert.equal(cell.total, 2);
  assert.equal(cell.positive, 0);
  assert.equal(cell.p, 0);
});

test('aggregate: mixed counts yield exact ratio', () => {
  // Wed (dow=3), block 2 (12-17): 3 positive, 1 negative → p=0.75
  const events = [
    { timestamp: at(2026, 4, 15, 12).toString(), value: 1 },
    { timestamp: at(2026, 4, 15, 13).toString(), value: 1 },
    { timestamp: at(2026, 4, 15, 14).toString(), value: 1 },
    { timestamp: at(2026, 4, 15, 16, 59, 59).toString(), value: 0 },
    // Different bucket to make sure counts don't bleed:
    { timestamp: at(2026, 4, 12, 2).toString(), value: 1 }, // Sun block 0
  ];
  const agg = aggregate(events);
  const wed = agg.get(bucketKey(3, 2));
  assert.equal(wed.total, 4);
  assert.equal(wed.positive, 3);
  assert.equal(wed.p, 0.75);
  const sun = agg.get(bucketKey(0, 0));
  assert.equal(sun.total, 1);
  assert.equal(sun.positive, 1);
  assert.equal(sun.p, 1);
});

test('aggregate: other buckets unaffected remain null', () => {
  const events = [{ timestamp: at(2026, 4, 15, 10).toString(), value: 1 }];
  const agg = aggregate(events);
  const untouched = agg.get(bucketKey(0, 3));
  assert.equal(untouched.total, 0);
  assert.equal(untouched.p, null);
});
