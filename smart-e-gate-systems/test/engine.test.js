/* Smart E-Gate Systems — engine unit tests. Author: Christina Apriani. */
"use strict";
const assert = require("assert");
const engine = require("../src/engine");

let passed = 0,
  failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failed++;
    console.log("  ✗ " + name + "\n      " + e.message);
  }
}

const vehicle = {
  plate: "B 9114 KDT",
  jbi_kg: 34000,
  tare_kg: 11500,
  max_len_mm: 12200,
  max_wid_mm: 2500,
  max_hei_mm: 4200,
  kir_number: "KIR-X",
  kir_expiry: "2999-01-01",
};
const manifest = { container_code: "TGHU 2048115", cargo_weight_kg: 21500, sppb_number: "SPPB-1" };
const customsOK = { sppb_number: "SPPB-1", status: "APPROVED" };
const customsPending = { sppb_number: "SPPB-1", status: "PENDING" };

const goodReading = {
  wim_kg: 33000,
  len_mm: 12100,
  wid_mm: 2490,
  hei_mm: 4150,
  plate_ocr: "B 9114 KDT",
  ocr_conf: 0.98,
  container_code: "TGHU 2048115",
};

console.log("\nSmart E-Gate decision engine");

test("clean pass => GREEN, gate opens", () => {
  const r = engine.decide(goodReading, { vehicle, manifest, customs: customsOK });
  assert.strictEqual(r.lane, "GREEN");
  assert.strictEqual(r.action.gate, "OPEN");
  assert.strictEqual(r.reasons.length, 0);
});

test("overload => RED", () => {
  const r = engine.decide({ ...goodReading, wim_kg: 39000 }, { vehicle, manifest, customs: customsOK });
  assert.strictEqual(r.lane, "RED");
  assert.ok(r.reasons.some((x) => /overload/i.test(x)));
  assert.strictEqual(r.action.siren, true);
});

test("over dimension (height) => RED", () => {
  const r = engine.decide({ ...goodReading, hei_mm: 4600 }, { vehicle, manifest, customs: customsOK });
  assert.strictEqual(r.lane, "RED");
  assert.ok(r.reasons.some((x) => /dimensi|overdimension/i.test(x)));
});

test("weight anomaly vs manifest => RED", () => {
  // expected = 11500 + 21500 = 33000; feed 28000 (>8% low) but still under JBI
  const r = engine.decide({ ...goodReading, wim_kg: 28000 }, { vehicle, manifest, customs: customsOK });
  assert.strictEqual(r.lane, "RED");
  assert.ok(r.reasons.some((x) => /anomali/i.test(x)));
});

test("expired KIR => RED", () => {
  const r = engine.decide(goodReading, {
    vehicle: { ...vehicle, kir_expiry: "2000-01-01" },
    manifest,
    customs: customsOK,
  });
  assert.strictEqual(r.lane, "RED");
  assert.ok(r.reasons.some((x) => /KIR/i.test(x)));
});

test("SPPB pending => RED", () => {
  const r = engine.decide(goodReading, { vehicle, manifest, customs: customsPending });
  assert.strictEqual(r.lane, "RED");
  assert.ok(r.reasons.some((x) => /SPPB/i.test(x)));
});

test("unregistered vehicle => RED", () => {
  const r = engine.decide(goodReading, { vehicle: null, manifest: null, customs: null });
  assert.strictEqual(r.lane, "RED");
});

console.log("\n  " + passed + " passed, " + failed + " failed\n");
process.exit(failed ? 1 : 0);
