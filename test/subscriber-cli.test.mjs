import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/list-buttondown-subscribers.mjs", import.meta.url));
function cli(input, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    input, encoding: "utf8", env: {}, timeout: 10000,
  });
}
test("subscriber CLI help loads its published runtime without account access", () => {
  const result = cli("", ["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /list-buttondown-subscribers/);
});
test("subscriber CLI refuses invalid input before credential lookup", () => {
  const result = cli("{}\n");
  assert.equal(result.status, 2, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.ok, false);
  assert.equal(record.refusal.reason, "InvalidInput");
});
test("subscriber CLI refuses malformed NDJSON with machine-readable output", () => {
  const result = cli("{\n");
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, false);
});
