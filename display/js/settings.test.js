import test from "node:test";
import assert from "node:assert/strict";
import { bars, stepUp, stepDown } from "./settings.js";

test("bars: dBm → Signalbalken", () => {
  assert.equal(bars(null), 0);
  assert.equal(bars(-90), 0);
  assert.equal(bars(-80), 1);
  assert.equal(bars(-60), 3);
  assert.equal(bars(-52), 4);
});

test("Stepper: Raster und Werte dazwischen", () => {
  assert.equal(stepUp(5), 10);
  assert.equal(stepDown(5), 3);
  assert.equal(stepUp(7), 10);
  assert.equal(stepDown(7), 5);
  assert.equal(stepDown(1), undefined);
  assert.equal(stepUp(600), undefined);
});
