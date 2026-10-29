import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const PUBLIC = "https://registry.npmjs.org/";
const HOUSE = "https://registry.561.group/";
const HOUSE_SCOPES = [
  "@561-group", "@causeway-services", "@coesite-operations",
  "@emsenn", "@lenticule-science", "@red-cup-engineering",
];

function packageName(path) {
  return path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
}
function isHouse(path) {
  const name = packageName(path);
  return HOUSE_SCOPES.some((scope) => name.startsWith(scope + "/"));
}
function verifyRouting(packages) {
  let house = 0, publicCount = 0;
  for (const [path, item] of Object.entries(packages)) {
    if (!item.resolved) continue;
    const internal = isHouse(path);
    const expected = internal ? HOUSE : PUBLIC;
    if (!item.resolved.startsWith(expected)) {
      throw new Error(`Incorrect registry for ${path}: expected ${expected}`);
    }
    if (!/^sha(256|384|512)-/u.test(item.integrity ?? "")) {
      throw new Error(`Missing immutable integrity for ${path}`);
    }
    if (internal) house++; else publicCount++;
  }
  return { house, publicCount };
}

test("scope-specific .npmrc uses public npm for outside dependencies and only original house scopes for house packages", () => {
  const npmrc = readFileSync(new URL(".npmrc", ROOT), "utf8");
  assert.equal(npmrc.split("\n")[0], `registry=${PUBLIC}`);
  for (const scope of HOUSE_SCOPES) {
    assert.ok(npmrc.split("\n").includes(`${scope}:registry=${HOUSE}`));
  }
});

test("all locked direct and transitive tarballs have source-appropriate registries and SRI", () => {
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", ROOT), "utf8"));
  const { house, publicCount } = verifyRouting(lock.packages);
  assert.ok(house > 0 && publicCount > 0);
});

test("public package routed through house mirror is rejected", () => {
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", ROOT), "utf8"));
  const [path, item] = Object.entries(lock.packages).find(([name, value]) => !isHouse(name) && value.resolved);
  assert.throws(() => verifyRouting({ [path]: { ...item, resolved: item.resolved.replace(PUBLIC, HOUSE) } }), /Incorrect registry/u);
});

test("house package routed to public registry is rejected without dependency-confusion fallback", () => {
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", ROOT), "utf8"));
  const [path, item] = Object.entries(lock.packages).find(([name, value]) => isHouse(name) && value.resolved);
  assert.throws(() => verifyRouting({ [path]: { ...item, resolved: item.resolved.replace(HOUSE, PUBLIC) } }), /Incorrect registry/u);
});
