import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreateEmailRequest,
  buildListSubscribersRequest,
  buildSendEmailRequest,
  createDraftEmail,
  EMAIL_CREATE_STATUSES,
  EMAIL_TYPES,
  listSubscribers,
  normalizeEmailResponse,
  normalizeSendEmailResponse,
  normalizeSubscribersResponse,
  sendEmail,
  SUBSCRIBER_PROGRAMMATIC_TYPES,
  subscriberCounts,
} from "../src/buttondown.mjs";

// Fixtures: hand-built, doc-derived. Requests are quoted verbatim from
// the API docs (see README.md "Verified facts"); response bodies were
// not rendered in the fetched doc pages, so they're inferred (DRF list
// envelope, echoed request fields) — disclosed, not verbatim.

const DRAFT_EMAIL_RESPONSE = { id: "1a2b3c4d-0000-0000-0000-000000000001", subject: "My email", body: "Hello", status: "draft", publish_date: null };
const SCHEDULED_EMAIL_RESPONSE = { id: "1a2b3c4d-0000-0000-0000-000000000002", subject: "My scheduled email", body: "Hello, future!", status: "scheduled", publish_date: "2096-12-31T12:00:00Z" };
const SUBSCRIBERS_PAGE_ONE = {
  count: 3, next: "https://api.buttondown.com/v1/subscribers?page=2", previous: null,
  results: [
    { id: "s1", email_address: "a@example.com", type: "regular" },
    { id: "s2", email_address: "b@example.com", type: "premium" },
  ],
};
const SUBSCRIBERS_PAGE_TWO = { count: 3, next: null, previous: "https://api.buttondown.com/v1/subscribers?page=1", results: [{ id: "s3", email_address: "c@example.com", type: "regular" }] };

test("buildCreateEmailRequest forms the documented draft creation request", () => {
  const { url, init } = buildCreateEmailRequest({ subject: "My email", body: "Hello" });
  assert.equal(url, "https://api.buttondown.com/v1/emails");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body), { subject: "My email", body: "Hello", status: "draft", email_type: "public" });
  assert.equal("authorization" in init.headers, false);
});

test("buildCreateEmailRequest forms the documented scheduled request with publish_date", () => {
  const { init } = buildCreateEmailRequest({ subject: "My scheduled email", body: "Hello, future!", status: "scheduled", publishDate: "2096-12-31T12:00:00Z" });
  assert.deepEqual(JSON.parse(init.body), { subject: "My scheduled email", body: "Hello, future!", status: "scheduled", email_type: "public", publish_date: "2096-12-31T12:00:00.000Z" });
});

test("buildCreateEmailRequest refuses invalid input", () => {
  assert.throws(() => buildCreateEmailRequest({ subject: "", body: "x" }), /nonempty subject/u);
  assert.throws(() => buildCreateEmailRequest({ subject: "x", body: "" }), /nonempty body/u);
  assert.throws(() => buildCreateEmailRequest({ subject: "x", body: "y", status: "sent" }), /must be one of/u);
  assert.throws(() => buildCreateEmailRequest({ subject: "x", body: "y", emailType: "patrons" }), /email type must be one of/u);
  assert.throws(() => buildCreateEmailRequest({ subject: "x", body: "y", status: "scheduled" }), /publishDate/u);
  assert.throws(() => buildCreateEmailRequest({ subject: "x", body: "y", publishDate: "2096-01-01T00:00:00Z" }), /refuses a publishDate/u);
  assert.deepEqual(EMAIL_CREATE_STATUSES, ["draft", "scheduled"]);
  assert.deepEqual(EMAIL_TYPES, ["public", "private", "premium"]);
});

test("buildCreateEmailRequest marks a paid issue as a premium email", () => {
  const { init } = buildCreateEmailRequest({ subject: "Paid episode", body: "Story", emailType: "premium" });
  assert.equal(JSON.parse(init.body).email_type, "premium");
});

test("normalizeEmailResponse reads the documented fields", () => {
  assert.deepEqual(normalizeEmailResponse(DRAFT_EMAIL_RESPONSE), { id: DRAFT_EMAIL_RESPONSE.id, subject: "My email", status: "draft", publishDate: null, response: DRAFT_EMAIL_RESPONSE });
  assert.equal(normalizeEmailResponse(SCHEDULED_EMAIL_RESPONSE).publishDate, "2096-12-31T12:00:00.000Z");
  assert.throws(() => normalizeEmailResponse({}), /no valid id/u);
});

test("createDraftEmail attaches the documented Authorization header and returns the normalized draft", async () => {
  let seen;
  const result = await createDraftEmail({
    token: "abc123", subject: "My email", body: "Hello",
    fetch: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(DRAFT_EMAIL_RESPONSE), { status: 200 }); },
  });
  assert.equal(seen.url, "https://api.buttondown.com/v1/emails");
  assert.equal(seen.init.headers.authorization, "Token abc123");
  assert.equal(result.id, DRAFT_EMAIL_RESPONSE.id);
  assert.equal(result.status, "draft");
});

test("createDraftEmail surfaces a non-OK response as an error", async () => {
  await assert.rejects(
    createDraftEmail({ token: "abc123", subject: "x", body: "y", fetch: async () => new Response("bad request", { status: 400 }) }),
    /emails\.create 400/u,
  );
});

test("createDraftEmail requires an injected fetch capability and a nonempty token", async () => {
  await assert.rejects(createDraftEmail({ token: "abc123", subject: "x", body: "y" }), /injected fetch capability/u);
  await assert.rejects(createDraftEmail({ fetch: async () => new Response("{}"), subject: "x", body: "y" }), /nonempty API token/u);
});

test("buildSendEmailRequest forms the documented send-draft request", () => {
  const { url, init } = buildSendEmailRequest({ emailId: "1a2b3c4d-0000-0000-0000-000000000001" });
  assert.equal(url, "https://api.buttondown.com/v1/emails/1a2b3c4d-0000-0000-0000-000000000001/send-draft");
  assert.equal(init.method, "POST");
  assert.throws(() => buildSendEmailRequest({}), /requires its emailId/u);
});

test("normalizeSendEmailResponse tolerates an empty body and anchors on the requested emailId", () => {
  assert.deepEqual(normalizeSendEmailResponse("email-1", {}), { id: "email-1", status: "about_to_send", response: {} });
  assert.deepEqual(normalizeSendEmailResponse("email-1", { id: "email-1", status: "sent" }), { id: "email-1", status: "sent", response: { id: "email-1", status: "sent" } });
});

test("sendEmail calls the documented endpoint with the Authorization header", async () => {
  let seen;
  const result = await sendEmail({
    token: "abc123", emailId: "email-1",
    fetch: async (url, init) => { seen = { url, init }; return new Response("", { status: 202 }); },
  });
  assert.equal(seen.url, "https://api.buttondown.com/v1/emails/email-1/send-draft");
  assert.equal(seen.init.headers.authorization, "Token abc123");
  assert.equal(result.id, "email-1");
});

test("buildListSubscribersRequest defaults to the first page and refuses a foreign pagination URL", () => {
  assert.equal(buildListSubscribersRequest().url, "https://api.buttondown.com/v1/subscribers");
  assert.throws(() => buildListSubscribersRequest({ url: "https://evil.example/subscribers" }), /foreign pagination URL/u);
  assert.equal(buildListSubscribersRequest({ url: SUBSCRIBERS_PAGE_ONE.next }).url, SUBSCRIBERS_PAGE_ONE.next);
});

test("normalizeSubscribersResponse reads the pagination envelope and per-subscriber type", () => {
  const normalized = normalizeSubscribersResponse(SUBSCRIBERS_PAGE_ONE);
  assert.equal(normalized.count, 3);
  assert.equal(normalized.next, SUBSCRIBERS_PAGE_ONE.next);
  assert.deepEqual(normalized.subscribers.map((s) => [s.email, s.subscriberType]), [["a@example.com", "regular"], ["b@example.com", "premium"]]);
  assert.throws(() => normalizeSubscribersResponse({ results: [{}] }), /no email/u);
});

test("listSubscribers attaches the documented Authorization header", async () => {
  let seen;
  const page = await listSubscribers({
    token: "abc123",
    fetch: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(SUBSCRIBERS_PAGE_ONE), { status: 200 }); },
  });
  assert.equal(seen.url, "https://api.buttondown.com/v1/subscribers");
  assert.equal(seen.init.headers.authorization, "Token abc123");
  assert.equal(page.subscribers.length, 2);
});

test("subscriberCounts pages through next links and tallies by subscriberType", async () => {
  const calls = [];
  const result = await subscriberCounts({
    token: "abc123",
    fetch: async (url) => { calls.push(String(url)); return new Response(JSON.stringify(String(url).includes("page=2") ? SUBSCRIBERS_PAGE_TWO : SUBSCRIBERS_PAGE_ONE), { status: 200 }); },
  });
  assert.deepEqual(calls, ["https://api.buttondown.com/v1/subscribers", SUBSCRIBERS_PAGE_ONE.next]);
  assert.equal(result.total, 3);
  assert.deepEqual(result.byType, { regular: 2, premium: 1 });
  assert.deepEqual(SUBSCRIBER_PROGRAMMATIC_TYPES, ["regular", "unsubscribed", "gifted", "unpaid"]);
});
