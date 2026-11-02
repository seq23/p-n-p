// One rule for every length check in this repo (owner ruling, 2 Nov 2026: "no petty
// validation"): over a length or word limit never fails; under a floor fails only
// below 75% of it. Validators call these instead of comparing to a raw number.
const FLOOR_RATIO = 0.75;

// True when `len` is short enough to block: strictly below 75% of `floor`.
const belowFloor = (len, floor) => Number(len) < floor * FLOOR_RATIO;

// The length a validator actually enforces for a floor, for messages.
const enforcedFloor = (floor) => Math.ceil(floor * FLOOR_RATIO);

module.exports = { FLOOR_RATIO, belowFloor, enforcedFloor };

// `node scripts/lib/length_floor.js --self-test`: proves the rule both ways.
if (require.main === module && process.argv.includes('--self-test')) {
  const cases = [
    [70, 52, true], [70, 53, false], [70, 69, false], [70, 500, false],
    [80, 59, true], [80, 60, false], [11, 8, true], [11, 9, false], [11, 0, true],
  ];
  const bad = cases.filter(([f, l, want]) => belowFloor(l, f) !== want);
  if (!cases.length || bad.length) { console.error(`length_floor self-test FAIL: ${JSON.stringify(bad)}`); process.exit(1); }
  console.log(`length_floor self-test OK (${cases.length} cases)`);
}
