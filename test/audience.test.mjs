import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ADVANCE_READER_TAG, advanceReaderRoster, buildCreateSubscriberRequest, embedSubscribeForm, subscribe, subscribePageUrl } from "../src/buttondown.mjs";
import { newsletterKey, newsletterKeyPath, readNewsletterKey, writeNewsletterKey } from "../src/newsletter-keys.mjs";

// A newsletter held in memory, answering the subscriber endpoints the way Buttondown's OpenAPI document describes.
function newsletter(rows = []) {
  const subscribers = new Map(rows.map((row) => [row.email_address, { metadata: {}, tags: [], ...row }]));
  const calls = [];
  const reply = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  async function fetchImpl(url, init) {
    const { pathname, searchParams } = new URL(url);
    calls.push({ method: init.method, pathname, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    assert.equal(init.headers.authorization, "Token newsletter-key");
    const one = pathname.match(/^\/v1\/subscribers\/(.+)$/u);
    if (one && init.method === "GET") return subscribers.has(decodeURIComponent(one[1])) ? reply(200, subscribers.get(decodeURIComponent(one[1]))) : reply(404, { code: "not_found" });
    if (one && init.method === "PATCH") { const row = subscribers.get(decodeURIComponent(one[1])); Object.assign(row, JSON.parse(init.body)); return reply(200, row); }
    if (pathname === "/v1/subscribers" && init.method === "POST") {
      const body = JSON.parse(init.body);
      const existing = subscribers.get(body.email_address);
      if (existing && init.headers["x-buttondown-collision-behavior"] !== "add") return reply(400, { code: "email_already_exists" });
      const row = { id: existing?.id ?? `sub_${subscribers.size + 1}`, ...existing, ...body, tags: [...new Set([...(existing?.tags ?? []), ...body.tags])] };
      subscribers.set(body.email_address, row);
      return reply(201, row);
    }
    if (pathname === "/v1/subscribers" && init.method === "GET") {
      const tag = searchParams.get("tag");
      const results = [...subscribers.values()].filter((row) => !tag || row.tags.includes(tag));
      return reply(200, { count: results.length, next: null, previous: null, results });
    }
    return reply(404, {});
  }
  return { fetch: fetchImpl, calls, subscribers };
}

const token = "newsletter-key";

test("a new reader is created unactivated, so Buttondown asks them to confirm, with how they asked kept as metadata", async () => {
  const list = newsletter();
  const result = await subscribe({ token, fetch: list.fetch, email: "reader@example.com", consent: "replied 2026-10-03 to the Ice Out outreach asking to join the team", tags: [ADVANCE_READER_TAG], metadata: { name: "A Reader" } });
  assert.equal(result.disposition, "confirming");
  const created = list.calls.find((call) => call.method === "POST").body;
  assert.equal(created.type, "unactivated");
  assert.deepEqual(created.tags, [ADVANCE_READER_TAG]);
  assert.equal(created.metadata.name, "A Reader");
  assert.match(created.metadata.consent, /replied 2026-10-03/u);
  assert.throws(() => buildCreateSubscriberRequest({ email: "reader@example.com" }), /own request/u);
});

test("an existing subscriber keeps their type and gains the tag; asking twice changes nothing", async () => {
  const list = newsletter([{ id: "sub_a", email_address: "reader@example.com", type: "regular", tags: ["newsletter"] }]);
  assert.equal((await subscribe({ token, fetch: list.fetch, email: "reader@example.com", consent: "asked by reply", tags: [ADVANCE_READER_TAG] })).disposition, "tagged");
  const patch = list.calls.find((call) => call.method === "PATCH").body;
  assert.equal("type" in patch, false);
  assert.deepEqual(patch.tags, ["newsletter", ADVANCE_READER_TAG]);
  assert.equal((await subscribe({ token, fetch: list.fetch, email: "reader@example.com", consent: "asked again", tags: [ADVANCE_READER_TAG] })).disposition, "unchanged");
});

test("an unsubscribed reader is re-invited through a confirmation, never resubscribed; a suppressed one is left alone", async () => {
  const list = newsletter([{ id: "sub_u", email_address: "gone@example.com", type: "unsubscribed" }, { id: "sub_c", email_address: "complained@example.com", type: "complained" }]);
  assert.equal((await subscribe({ token, fetch: list.fetch, email: "gone@example.com", consent: "asked by reply" })).disposition, "reinvited");
  const post = list.calls.find((call) => call.method === "POST");
  assert.equal(post.headers["x-buttondown-collision-behavior"], "add");
  assert.equal(post.body.type, "unactivated");
  const before = list.calls.length;
  assert.equal((await subscribe({ token, fetch: list.fetch, email: "complained@example.com", consent: "asked by reply" })).disposition, "suppressed");
  assert.equal(list.calls.length, before + 1);
});

test("the advance-reader roster is the confirmed tagged subscribers, referenced by their Buttondown id", async () => {
  const list = newsletter([
    { id: "sub_1", email_address: "one@example.com", type: "regular", tags: [ADVANCE_READER_TAG], metadata: { name: "Reader One" } },
    { id: "sub_2", email_address: "two@example.com", type: "unactivated", tags: [ADVANCE_READER_TAG] },
    { id: "sub_3", email_address: "three@example.com", type: "premium", tags: [ADVANCE_READER_TAG] },
    { id: "sub_4", email_address: "four@example.com", type: "regular", tags: ["newsletter"] },
  ]);
  assert.deepEqual(await advanceReaderRoster({ token, fetch: list.fetch, newsletter: "sigridsong" }), [
    { name: "Reader One", email: "one@example.com", reference: "sigridsong/sub_1" },
    { name: "three@example.com", email: "three@example.com", reference: "sigridsong/sub_3" },
  ]);
  assert.equal(new URL(`https://api.buttondown.com${list.calls[0].pathname}?tag=x`).pathname, "/v1/subscribers");
});

test("the embed form posts to Buttondown's double opt-in endpoint with the tag hidden", () => {
  const html = embedSubscribeForm({ newsletter: "sigridsong", tags: [ADVANCE_READER_TAG], fields: [{ key: "name", label: "Name on your copy" }], button: "Join the advance-reader team" });
  assert.match(html, /action="https:\/\/buttondown\.com\/api\/emails\/embed-subscribe\/sigridsong" method="post"/u);
  assert.match(html, /<input type="hidden" name="tag" value="advance-reader-team">/u);
  assert.match(html, /name="metadata__name"/u);
  assert.throws(() => embedSubscribeForm({ newsletter: "bad name" }), /names its Buttondown newsletter/u);
});

test("the hosted subscribe page carries each tag as a query parameter", () => {
  assert.equal(subscribePageUrl({ newsletter: "sigridsong" }), "https://buttondown.com/sigridsong");
  assert.equal(subscribePageUrl({ newsletter: "sigridsong", tags: [ADVANCE_READER_TAG] }), "https://buttondown.com/sigridsong?tag=advance-reader-team");
  assert.throws(() => subscribePageUrl({ newsletter: "bad name" }), /names its Buttondown newsletter/u);
});

test("each newsletter's key is one 0600 file named by its routing name", async () => {
  const home = await mkdtemp(join(tmpdir(), "buttondown-keys-"));
  assert.equal(await readNewsletterKey("sigridsong", { home }), null);
  await assert.rejects(newsletterKey("sigridsong", { home }), /persona-provision/u);
  const path = await writeNewsletterKey("sigridsong", "abc123\n", { home });
  assert.equal(path, newsletterKeyPath("sigridsong", { home }));
  assert.equal(path, join(home, ".config", "561-group", "buttondown", "sigridsong.api-key"));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(await readFile(path, "utf8"), "abc123\n");
  assert.equal(await newsletterKey("sigridsong", { home }), "abc123");
  assert.throws(() => newsletterKeyPath("../etc", { home }), /routing name/u);
});
