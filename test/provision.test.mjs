import assert from "node:assert/strict";
import test from "node:test";
import { provisionNewsletter } from "../src/provision.mjs";

function buttondown(newsletter) {
  const patches = [];
  return {
    patches,
    async fetch(url, init) {
      const { pathname } = new URL(url);
      if (init.headers.authorization !== "Token key-for-sigridsong-0000") return new Response("{}", { status: 401 });
      if (pathname === "/v1/newsletters" && init.method === "GET") return Response.json({ count: 1, next: null, previous: null, results: [newsletter] });
      if (pathname === `/v1/newsletters/${newsletter.id}` && init.method === "PATCH") { const body = JSON.parse(init.body); patches.push(body); Object.assign(newsletter, body); return Response.json(newsletter); }
      return new Response("{}", { status: 404 });
    },
  };
}
const profile = { name: "Sigrid Song", description: "Slow, warm love stories set on the shore of Lake Superior.", from_name: "Sigrid Song", reply_to_address: "sigrid.song@fastmail.com" };

test("without a key the account and key are the person's step, then the profile is set over the API", async () => {
  const held = new Map();
  const keys = { read: async (name) => held.get(name) ?? null, write: async (name, key) => held.set(name, key) };
  const remote = buttondown({ id: "nl_1", username: "sigridsong", name: "sigridsong", description: "", from_name: "", reply_to_address: "" });
  assert.deepEqual(await provisionNewsletter({ newsletter: "sigridsong", email: "sigrid.song@fastmail.com", profile, fetch: remote.fetch, keys }), { platform: "buttondown", newsletter: "sigridsong", url: "https://buttondown.com/sigridsong", state: "waits-on-person", step: "account" });
  assert.equal((await provisionNewsletter({ newsletter: "sigridsong", email: "x", profile, fetch: remote.fetch, keys, dryRun: true })).state, "would-create");
  const asked = [];
  const person = { async ask(step) { asked.push(step); return "key-for-sigridsong-0000\n"; } };
  const made = await provisionNewsletter({ newsletter: "sigridsong", email: "sigrid.song@fastmail.com", profile, person, fetch: remote.fetch, keys });
  assert.equal(made.state, "created");
  assert.deepEqual(made.changed, ["name", "description", "from_name", "reply_to_address"]);
  assert.equal(held.get("sigridsong"), "key-for-sigridsong-0000");
  assert.match(asked[0].text, /username sigridsong and the address sigrid\.song@fastmail\.com/u);
  assert.equal(asked[0].input.pattern.test("key-for-sigridsong-0000"), true);
  const again = await provisionNewsletter({ newsletter: "sigridsong", email: "sigrid.song@fastmail.com", profile, fetch: remote.fetch, keys });
  assert.deepEqual([again.state, again.changed], ["held", []]);
  assert.equal(remote.patches.length, 1);
});

test("a key that belongs to another newsletter is refused", async () => {
  const keys = { read: async () => "key-for-sigridsong-0000", write: async () => {} };
  const remote = buttondown({ id: "nl_2", username: "someone-else" });
  await assert.rejects(provisionNewsletter({ newsletter: "sigridsong", email: "x", profile, fetch: remote.fetch, keys }), /belongs to the newsletter someone-else/u);
});
