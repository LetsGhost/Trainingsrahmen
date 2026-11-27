const test = require("node:test");
const assert = require("node:assert");
const { createReset } = require("./reset");

test("Reset lässt nur die Aktionen des passenden Modus zu", () => {
  const normal = createReset({ rootDir: ".", baseDir: ".", demo: false });
  const demo = createReset({ rootDir: ".", baseDir: ".", demo: true });
  assert.throws(() => normal("demo-off"), { code: "WRONG_MODE" });
  assert.throws(() => normal("demo-fresh"), { code: "WRONG_MODE" });
  assert.throws(() => demo("factory"), { code: "WRONG_MODE" });
  assert.throws(() => demo("toString"), { code: "UNKNOWN" });
  assert.throws(() => normal(undefined), { code: "UNKNOWN" });
});
