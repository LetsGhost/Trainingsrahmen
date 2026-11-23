import test from "node:test";
import assert from "node:assert/strict";
import { splitTitle } from "./day.js";

test("splitTitle: Klammer am Ende wird Untertitel", () => {
  assert.deepEqual(splitTitle("Plan A – Unterkörper (Hüfte & Rumpf)"), ["Plan A – Unterkörper", "Hüfte & Rumpf"]);
  assert.deepEqual(splitTitle("Longride"), ["Longride", null]);
  assert.deepEqual(splitTitle("4 × (400 m) locker"), ["4 × (400 m) locker", null]);
});
