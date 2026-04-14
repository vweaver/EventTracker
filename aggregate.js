// aggregate.js — pure functions: bucket mapping + aggregation.
//
// No side effects, no DOM, no DB. See TECH_SPEC.md "Bucket mapping
// (`aggregate.js`, pure)" and PRD.md "Time Blocks"/"Aggregation".

/**
 * Half-open [start, end) block boundaries per PRD "Time Blocks".
 * Indices map to getHours() ranges:
 *   0: 00..08  (00–09)
 *   1: 09..11  (09–12)
 *   2: 12..16  (12–17)
 *   3: 17..23  (17–24)
 */
export const BLOCKS = [
  { index: 0, label: '00–09', start: 0, end: 9 },
  { index: 1, label: '09–12', start: 9, end: 12 },
  { index: 2, label: '12–17', start: 12, end: 17 },
  { index: 3, label: '17–24', start: 17, end: 24 },
];

export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Return { dow, block } for a Date. `dow` uses getDay() (Sun=0..Sat=6);
 * `block` 0..3 via half-open hour ranges above.
 */
export function bucketOf(date) {
  const h = date.getHours();
  let block;
  if (h < 9) block = 0;
  else if (h < 12) block = 1;
  else if (h < 17) block = 2;
  else block = 3;
  return { dow: date.getDay(), block };
}

export function bucketKey(dow, block) {
  return `${dow},${block}`;
}

/**
 * Aggregate a list of events into 28 buckets. Always returns all 28
 * keys; { positive, total, p } where p === null when total === 0.
 *
 * `events` items: { timestamp: string, value: 0|1 }.
 */
export function aggregate(events) {
  const out = new Map();
  for (let dow = 0; dow < 7; dow++) {
    for (let block = 0; block < 4; block++) {
      out.set(bucketKey(dow, block), { positive: 0, total: 0, p: null });
    }
  }
  for (const e of events) {
    const d = new Date(e.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const { dow, block } = bucketOf(d);
    const cell = out.get(bucketKey(dow, block));
    cell.total += 1;
    if (e.value) cell.positive += 1;
  }
  for (const cell of out.values()) {
    cell.p = cell.total === 0 ? null : cell.positive / cell.total;
  }
  return out;
}
