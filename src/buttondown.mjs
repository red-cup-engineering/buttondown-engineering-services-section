const API_ORIGIN = "https://api.buttondown.com";
const API_VERSION = "v1";
const MAX_JSON_BYTES = 1_000_000;
const SUBSCRIBERS_PAGE_MAX = 1000;
const SUBSCRIBER_COUNT_MAX_PAGES = 1000;

/** Statuses admitted by POST /v1/emails at creation time (docs.buttondown.com/api-emails-create, docs.buttondown.com/scheduling-emails-via-the-api). */
export const EMAIL_CREATE_STATUSES = Object.freeze(["draft", "scheduled"]);
export const EMAIL_TYPES = Object.freeze(["public", "private", "premium"]);

/** subscriber_type values Buttondown documents as settable through the API (docs.buttondown.com/api-subscribers-type). */
export const SUBSCRIBER_PROGRAMMATIC_TYPES = Object.freeze(["regular", "unsubscribed", "gifted", "unpaid"]);

function apiUrl(path) {
  return `${API_ORIGIN}/${API_VERSION}${path}`;
}

function capability(fetchImpl, name) {
  if (typeof fetchImpl !== "function") throw new TypeError(`${name} requires an injected fetch capability`);
  return fetchImpl;
}

function tokenHeader(token) {
  if (typeof token !== "string" || !token.trim()) throw new TypeError("Buttondown operation requires a nonempty API token");
  return `Token ${token}`;
}

async function json(res, operation) {
  const text = await res.text();
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new TypeError(`${operation} response exceeds the bounded JSON limit`);
  if (!res.ok) throw new Error(`${operation} ${res.status}: ${text.slice(0, 300)}`);
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new TypeError(`${operation} returned malformed JSON`); }
}

/**
 * Build the request for creating a Buttondown email (draft or scheduled).
 * Verified against https://docs.buttondown.com/api-emails-create
 * (`POST https://api.buttondown.com/v1/emails` with `{subject, body, status}`)
 * and https://docs.buttondown.com/scheduling-emails-via-the-api (adds
 * `publish_date` in ISO 8601 when `status` is `"scheduled"`). The body
 * may carry the documented `email_type` audience projection; `premium`
 * restricts the issue to paid/gifted/trial subscribers.
 * accepts Markdown, which Buttondown auto-detects and renders to HTML.
 *
 * @param {object} input
 * @param {string} input.subject - nonempty email subject line
 * @param {string} input.body - Markdown (or HTML) email body
 * @param {"draft"|"scheduled"} [input.status="draft"]
 * @param {"public"|"private"|"premium"} [input.emailType="public"] - Buttondown audience; premium reaches paid subscribers
 * @param {string} [input.publishDate] - ISO 8601 instant, required when status is "scheduled"
 * @returns {{url: string, init: {method: string, redirect: string, headers: object, body: string}}}
 *   a fetch-ready request descriptor; the Authorization header is not yet attached
 * @throws {TypeError} on a missing subject/body, an inadmissible status, or a scheduled email without a valid publishDate
 */
export function buildCreateEmailRequest({ subject, body, status = "draft", publishDate, emailType = "public" } = {}) {
  if (typeof subject !== "string" || !subject.trim()) throw new TypeError("email creation requires a nonempty subject");
  if (typeof body !== "string" || !body.trim()) throw new TypeError("email creation requires a nonempty body");
  if (!EMAIL_CREATE_STATUSES.includes(status)) throw new TypeError(`email status must be one of ${EMAIL_CREATE_STATUSES.join(", ")}`);
  if (!EMAIL_TYPES.includes(emailType)) throw new TypeError(`email type must be one of ${EMAIL_TYPES.join(", ")}`);
  const payload = { subject, body, status, email_type: emailType };
  if (status === "scheduled") {
    if (!Number.isFinite(Date.parse(publishDate ?? ""))) throw new TypeError("scheduled email requires a valid ISO 8601 publishDate");
    payload.publish_date = new Date(publishDate).toISOString();
  } else if (publishDate !== undefined) {
    throw new TypeError("draft email refuses a publishDate");
  }
  return {
    url: apiUrl("/emails"),
    init: { method: "POST", redirect: "error", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload) },
  };
}

/**
 * Normalize a Buttondown `emails.create` API response into a bounded shape.
 * @param {unknown} payload - parsed JSON response body
 * @returns {{id: string, subject: string, status: string, publishDate: string|null, response: unknown}}
 * @throws {TypeError} if the response carries no valid id or a malformed publish_date
 */
export function normalizeEmailResponse(payload) {
  const id = payload?.id;
  if (typeof id !== "string" || !id) throw new TypeError("Buttondown email response carries no valid id");
  const publishDate = payload?.publish_date ?? null;
  if (publishDate !== null && !Number.isFinite(Date.parse(publishDate))) throw new TypeError("Buttondown email response carries a malformed publish_date");
  return {
    id,
    subject: typeof payload?.subject === "string" ? payload.subject : "",
    status: typeof payload?.status === "string" ? payload.status : "",
    publishDate: publishDate === null ? null : new Date(publishDate).toISOString(),
    response: payload,
  };
}

/**
 * Create a Buttondown email (draft or scheduled) and return its normalized record.
 * Credential-blind: the token is supplied by the caller on every call and
 * never read from the environment or embedded in this module.
 *
 * @param {object} input
 * @param {string} input.token - Buttondown API key
 * @param {typeof fetch} input.fetch - injected fetch capability
 * @param {string} input.subject
 * @param {string} input.body
 * @param {"draft"|"scheduled"} [input.status="draft"]
 * @param {string} [input.publishDate]
 * @param {"public"|"private"|"premium"} [input.emailType="public"]
 * @returns {Promise<{id: string, subject: string, status: string, publishDate: string|null, response: unknown}>}
 * @throws {TypeError} on invalid input or a malformed response
 * @throws {Error} on a non-OK HTTP response
 */
export async function createDraftEmail({ token, fetch: fetchImpl, subject, body, status, publishDate, emailType } = {}) {
  const call = capability(fetchImpl, "createDraftEmail");
  const { url, init } = buildCreateEmailRequest({ subject, body, status, publishDate, emailType });
  init.headers.authorization = tokenHeader(token);
  return normalizeEmailResponse(await json(await call(url, init), "emails.create"));
}

/**
 * Build the request to send an existing Buttondown draft email.
 * Verified against https://docs.buttondown.com/api-emails-send-draft
 * (`POST https://api.buttondown.com/v1/emails/{id}/send-draft`).
 *
 * @param {object} input
 * @param {string} input.emailId - the draft email's Buttondown id
 * @returns {{url: string, init: {method: string, redirect: string, headers: object}}}
 * @throws {TypeError} on a missing emailId
 */
export function buildSendEmailRequest({ emailId } = {}) {
  if (typeof emailId !== "string" || !emailId.trim()) throw new TypeError("sending an email requires its emailId");
  return { url: apiUrl(`/emails/${encodeURIComponent(emailId)}/send-draft`), init: { method: "POST", redirect: "error", headers: { accept: "application/json" } } };
}

/**
 * Normalize the send-draft response. The fetched documentation page for
 * this endpoint did not render an example response body, so this
 * normalizer tolerates an empty body and anchors identity on the
 * requested emailId rather than asserting an unverified response shape.
 *
 * @param {string} emailId
 * @param {unknown} payload
 * @returns {{id: string, status: string, response: unknown}}
 */
export function normalizeSendEmailResponse(emailId, payload) {
  const id = typeof payload?.id === "string" && payload.id ? payload.id : emailId;
  return { id, status: typeof payload?.status === "string" ? payload.status : "about_to_send", response: payload };
}

/**
 * Send an existing Buttondown draft email.
 * Credential-blind: the token is supplied by the caller on every call.
 *
 * @param {object} input
 * @param {string} input.token
 * @param {typeof fetch} input.fetch
 * @param {string} input.emailId
 * @returns {Promise<{id: string, status: string, response: unknown}>}
 * @throws {TypeError} on invalid input
 * @throws {Error} on a non-OK HTTP response
 */
export async function sendEmail({ token, fetch: fetchImpl, emailId } = {}) {
  const call = capability(fetchImpl, "sendEmail");
  const { url, init } = buildSendEmailRequest({ emailId });
  init.headers.authorization = tokenHeader(token);
  return normalizeSendEmailResponse(emailId, await json(await call(url, init), "emails.send-draft"));
}

/**
 * Build the request to list Buttondown subscribers.
 * Verified against https://docs.buttondown.com/api-subscribers-list
 * (`GET https://api.buttondown.com/v1/subscribers`). A prior page's
 * absolute `next`/`previous` URL may be passed back through `url` to
 * page through results.
 *
 * @param {object} [input]
 * @param {string} [input.url] - a prior page's absolute next/previous URL; defaults to the first page
 * @param {string} [input.tag] - only subscribers carrying this tag (the first page's `tag` filter; later pages carry it in `next`)
 * @returns {{url: string, init: {method: string, redirect: string, headers: object}}}
 * @throws {TypeError} if `url` does not resolve to the Buttondown API origin
 */
export function buildListSubscribersRequest({ url, tag } = {}) {
  const resolved = new URL(url ?? apiUrl("/subscribers"));
  if (resolved.origin !== API_ORIGIN) throw new TypeError("subscribers listing refuses a foreign pagination URL");
  if (tag !== undefined && !url) resolved.searchParams.set("tag", tagName(tag));
  return { url: resolved.href, init: { method: "GET", redirect: "error", headers: { accept: "application/json" } } };
}

/**
 * Normalize a Buttondown subscribers list response: the `SubscriberPage`
 * envelope (`count`/`next`/`previous`/`results`) of Buttondown's published
 * OpenAPI document (https://api.buttondown.com/v1/openapi.json, read
 * 2026-10-02), each result a `Subscriber` carrying `id`, `email_address`,
 * `type`, `tags` (tag names) and `metadata`.
 *
 * @param {unknown} payload
 * @returns {{count: number, next: string|null, previous: string|null, subscribers: Array<{id: string|null, email: string, subscriberType: string|null, tags: string[], metadata: object, raw: unknown}>}}
 * @throws {TypeError} if the page exceeds the bounded size or a subscriber carries no email
 */
export function normalizeSubscribersResponse(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (results.length > SUBSCRIBERS_PAGE_MAX) throw new TypeError("subscribers response exceeds the bounded page size");
  const count = Number.isInteger(payload?.count) ? payload.count : results.length;
  return {
    count,
    next: typeof payload?.next === "string" ? payload.next : null,
    previous: typeof payload?.previous === "string" ? payload.previous : null,
    subscribers: results.map(normalizeSubscriber),
  };
}

/**
 * List one page of Buttondown subscribers.
 * Credential-blind: the token is supplied by the caller on every call.
 *
 * @param {object} input
 * @param {string} input.token
 * @param {typeof fetch} input.fetch
 * @param {string} [input.url] - a prior page's next/previous URL to continue pagination
 * @param {string} [input.tag] - only subscribers carrying this tag
 * @returns {Promise<{count: number, next: string|null, previous: string|null, subscribers: Array<{email: string, subscriberType: string|null, raw: unknown}>}>}
 * @throws {TypeError} on invalid input or a malformed response
 * @throws {Error} on a non-OK HTTP response
 */
export async function listSubscribers({ token, fetch: fetchImpl, url, tag } = {}) {
  const call = capability(fetchImpl, "listSubscribers");
  const req = buildListSubscribersRequest({ url, tag });
  req.init.headers.authorization = tokenHeader(token);
  return normalizeSubscribersResponse(await json(await call(req.url, req.init), "subscribers.list"));
}

/**
 * Tally subscribers by type across the full (paginated) subscriber list.
 * Credential-blind: the token is supplied by the caller on every call.
 *
 * @param {object} input
 * @param {string} input.token
 * @param {typeof fetch} input.fetch
 * @returns {Promise<{total: number, byType: Record<string, number>}>}
 * @throws {TypeError} on invalid input or a malformed response
 * @throws {Error} on a non-OK HTTP response, or if pagination does not terminate within the bounded page count
 */
export async function subscriberCounts({ token, fetch: fetchImpl } = {}) {
  const call = capability(fetchImpl, "subscriberCounts");
  let page = await listSubscribers({ token, fetch: call });
  const byType = {};
  let total = 0;
  for (let pages = 0; ; pages++) {
    if (pages >= SUBSCRIBER_COUNT_MAX_PAGES) throw new Error("subscribers pagination exceeded the bounded page count");
    for (const subscriber of page.subscribers) {
      total++;
      const key = subscriber.subscriberType ?? "unknown";
      byType[key] = (byType[key] ?? 0) + 1;
    }
    if (!page.next) break;
    page = await listSubscribers({ token, fetch: call, url: page.next });
  }
  return { total, byType };
}

// Subscribers: one reader at a time, on that reader's own request. Facts from Buttondown's OpenAPI document
// (https://api.buttondown.com/v1/openapi.json, read 2026-10-02) and https://docs.buttondown.com/api-subscribers-create:
// a subscriber created with type "unactivated" (the default) gets Buttondown's confirmation email and stays unactivated
// until they confirm; GET and PATCH /v1/subscribers/{id_or_email} take an id or an address; tags are names, created
// on first use; the "add" collision behavior with type "unactivated" re-invites an unsubscribed address through a new
// confirmation email rather than resubscribing it.

/** Types Buttondown never lets the API move out of; a request for such an address is refused, not retried. */
export const SUPPRESSED_SUBSCRIBER_TYPES = Object.freeze(["blocked", "complained", "undeliverable", "removed"]);
/** Types that receive the newsletter. */
export const RECEIVING_SUBSCRIBER_TYPES = Object.freeze(["regular", "premium", "gifted", "trialed", "churning", "past_due", "unpaid"]);
/** The tag a reader chooses, separately from the newsletter, to receive advance review copies. */
export const ADVANCE_READER_TAG = "advance-reader-team";

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function emailAddress(email) {
  if (typeof email !== "string" || !EMAIL_ADDRESS.test(email.trim())) throw new TypeError("a subscriber is named by an email address");
  return email.trim();
}

function tagName(tag) {
  if (typeof tag !== "string" || !/^[a-z0-9][a-z0-9:_-]{0,99}$/u.test(tag)) throw new TypeError(`a tag is a stable lowercase name, not ${JSON.stringify(tag)}`);
  return tag;
}

/**
 * Normalize one `Subscriber` object.
 * @param {unknown} entry
 * @returns {{id: string|null, email: string, subscriberType: string|null, tags: string[], metadata: object, raw: unknown}}
 */
export function normalizeSubscriber(entry) {
  const email = typeof entry?.email_address === "string" && entry.email_address ? entry.email_address : entry?.email;
  if (typeof email !== "string" || !email) throw new TypeError("subscribers response contains a subscriber with no email");
  const subscriberType = typeof entry.type === "string" ? entry.type : (typeof entry.subscriber_type === "string" ? entry.subscriber_type : null);
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : null,
    email,
    subscriberType,
    tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === "string") : [],
    metadata: entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) ? entry.metadata : {},
    raw: entry,
  };
}

/**
 * Build the request reading one subscriber by address or id.
 * @param {{email: string}} input
 */
export function buildGetSubscriberRequest({ email } = {}) {
  return { url: apiUrl(`/subscribers/${encodeURIComponent(emailAddress(email))}`), init: { method: "GET", redirect: "error", headers: { accept: "application/json" } } };
}

/**
 * Build the request creating a subscriber who asked to join. The type is always "unactivated", so Buttondown sends
 * its confirmation email: nobody receives mail they did not confirm. `consent` says how the reader asked (a reply to an
 * outreach message, a form on a given page) and is kept in the subscriber's metadata as the evidence of that request.
 *
 * @param {object} input
 * @param {string} input.email
 * @param {string} input.consent - how and when this reader asked to join
 * @param {string[]} [input.tags]
 * @param {object} [input.metadata]
 * @param {string} [input.referrerUrl]
 * @param {boolean} [input.reinvite=false] - send "add" collision behavior, re-inviting an unsubscribed address through a new confirmation
 */
export function buildCreateSubscriberRequest({ email, consent, tags = [], metadata = {}, referrerUrl, reinvite = false } = {}) {
  if (typeof consent !== "string" || !consent.trim()) throw new TypeError("a subscriber is created only on the reader's own request; say how they asked (consent)");
  const payload = { email_address: emailAddress(email), type: "unactivated", tags: [...new Set(tags.map(tagName))], metadata: { ...metadata, consent: consent.trim() } };
  if (referrerUrl !== undefined) payload.referrer_url = new URL(referrerUrl).href;
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (reinvite) headers["x-buttondown-collision-behavior"] = "add";
  return { url: apiUrl("/subscribers"), init: { method: "POST", redirect: "error", headers, body: JSON.stringify(payload) } };
}

/**
 * Build the request adding tags (and metadata) to an existing subscriber, leaving their type alone.
 * @param {{email: string, tags: string[], metadata?: object}} input - `tags` is the full list to hold
 */
export function buildUpdateSubscriberRequest({ email, tags, metadata } = {}) {
  const payload = {};
  if (tags !== undefined) payload.tags = [...new Set(tags.map(tagName))];
  if (metadata !== undefined) payload.metadata = metadata;
  if (!Object.keys(payload).length) throw new TypeError("a subscriber update changes tags or metadata");
  return { url: apiUrl(`/subscribers/${encodeURIComponent(emailAddress(email))}`), init: { method: "PATCH", redirect: "error", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload) } };
}

/**
 * Read one subscriber, or null when the newsletter holds no such address.
 * @param {{token: string, fetch: typeof fetch, email: string}} input
 */
export async function getSubscriber({ token, fetch: fetchImpl, email } = {}) {
  const call = capability(fetchImpl, "getSubscriber");
  const { url, init } = buildGetSubscriberRequest({ email });
  init.headers.authorization = tokenHeader(token);
  const res = await call(url, init);
  if (res.status === 404) return null;
  return normalizeSubscriber(await json(res, "subscribers.retrieve"));
}

/**
 * Join a reader to a newsletter, with tags, on their own request.
 *
 * - An address the newsletter does not hold is created unactivated; Buttondown asks it to confirm.
 * - An unsubscribed address is re-invited through a new confirmation email, never resubscribed outright.
 * - A suppressed address (blocked, complained, undeliverable, removed) is left alone.
 * - Any other subscriber keeps their type and gains the tags; their metadata gains `consent`.
 *
 * @param {object} input - see buildCreateSubscriberRequest
 * @returns {Promise<{disposition: "confirming"|"reinvited"|"tagged"|"unchanged"|"suppressed", subscriber: object|null}>}
 */
export async function subscribe({ token, fetch: fetchImpl, email, consent, tags = [], metadata = {}, referrerUrl } = {}) {
  const call = capability(fetchImpl, "subscribe");
  const existing = await getSubscriber({ token, fetch: call, email });
  const create = async (reinvite) => {
    const { url, init } = buildCreateSubscriberRequest({ email, consent, tags, metadata, referrerUrl, reinvite });
    init.headers.authorization = tokenHeader(token);
    return normalizeSubscriber(await json(await call(url, init), "subscribers.create"));
  };
  if (!existing) return { disposition: "confirming", subscriber: await create(false) };
  if (SUPPRESSED_SUBSCRIBER_TYPES.includes(existing.subscriberType)) return { disposition: "suppressed", subscriber: null };
  if (existing.subscriberType === "unsubscribed") return { disposition: "reinvited", subscriber: await create(true) };
  const wanted = [...new Set([...existing.tags, ...tags.map(tagName)])];
  if (wanted.length === existing.tags.length) return { disposition: "unchanged", subscriber: existing };
  if (typeof consent !== "string" || !consent.trim()) throw new TypeError("a subscriber is tagged only on the reader's own request; say how they asked (consent)");
  const { url, init } = buildUpdateSubscriberRequest({ email, tags: wanted, metadata: { ...existing.metadata, ...metadata, consent: existing.metadata.consent ?? consent.trim() } });
  init.headers.authorization = tokenHeader(token);
  return { disposition: "tagged", subscriber: normalizeSubscriber(await json(await call(url, init), "subscribers.update")) };
}

/**
 * Every receiving subscriber carrying a tag, across all pages. An unactivated subscriber has not confirmed and is
 * not included.
 * @param {{token: string, fetch: typeof fetch, tag: string}} input
 */
export async function taggedSubscribers({ token, fetch: fetchImpl, tag } = {}) {
  const call = capability(fetchImpl, "taggedSubscribers");
  const found = [];
  let page = await listSubscribers({ token, fetch: call, tag });
  for (let pages = 0; ; pages++) {
    if (pages >= SUBSCRIBER_COUNT_MAX_PAGES) throw new Error("subscribers pagination exceeded the bounded page count");
    found.push(...page.subscribers.filter((subscriber) => subscriber.tags.includes(tag) && RECEIVING_SUBSCRIBER_TYPES.includes(subscriber.subscriberType)));
    if (!page.next) break;
    page = await listSubscribers({ token, fetch: call, url: page.next });
  }
  return found;
}

/**
 * A newsletter's advance-reader team as a review-copy roster: one row per confirmed subscriber carrying the
 * advance-reader tag, named by `metadata.name` when they gave one, referenced by their Buttondown id so a repeated
 * run gives nobody a second copy. The roster holds addresses and stays outside git.
 *
 * @param {{token: string, fetch: typeof fetch, newsletter: string, tag?: string}} input
 * @returns {Promise<Array<{name: string, email: string, reference: string}>>}
 */
export async function advanceReaderRoster({ token, fetch: fetchImpl, newsletter, tag = ADVANCE_READER_TAG } = {}) {
  if (typeof newsletter !== "string" || !newsletter) throw new TypeError("a roster names its newsletter");
  const team = await taggedSubscribers({ token, fetch: fetchImpl, tag });
  return team.map((subscriber) => {
    if (!subscriber.id) throw new TypeError("a subscriber on the advance-reader team carries no id");
    const name = typeof subscriber.metadata.name === "string" && subscriber.metadata.name.trim() ? subscriber.metadata.name.trim() : subscriber.email;
    return { name, email: subscriber.email, reference: `${newsletter}/${subscriber.id}` };
  });
}

/**
 * The newsletter's hosted subscribe page, for a page that carries links rather than HTML. Each tag is a `tag` query
 * parameter, which Buttondown applies to the reader who subscribes there (docs.buttondown.com/tags, read
 * 2026-10-02); the page runs the newsletter's double opt-in like the embed form.
 * @param {{newsletter: string, tags?: string[]}} input
 * @returns {string}
 */
export function subscribePageUrl({ newsletter, tags = [] } = {}) {
  if (typeof newsletter !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(newsletter)) throw new TypeError("a subscribe page names its Buttondown newsletter");
  const url = new URL(`https://buttondown.com/${newsletter}`);
  for (const tag of tags) url.searchParams.append("tag", tagName(tag));
  return url.href;
}

/**
 * The HTML sign-up form for a static page: a plain POST to Buttondown's embed-subscribe endpoint, which runs the
 * newsletter's double opt-in. `tags` are hidden `tag` inputs; `fields` are optional visible `metadata__<key>` inputs.
 *
 * @param {object} input
 * @param {string} input.newsletter - the Buttondown username
 * @param {string[]} [input.tags]
 * @param {Array<{key: string, label: string}>} [input.fields]
 * @param {string} [input.button="Subscribe"]
 * @param {string} [input.id] - the form element's id
 * @returns {string}
 */
export function embedSubscribeForm({ newsletter, tags = [], fields = [], button = "Subscribe", id } = {}) {
  if (typeof newsletter !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(newsletter)) throw new TypeError("an embed form names its Buttondown newsletter");
  const escape = (text) => String(text).replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const formId = id ? ` id="${escape(id)}"` : "";
  const extra = fields.map(({ key, label }) => {
    if (!/^[a-z0-9_-]{1,40}$/u.test(key)) throw new TypeError(`a metadata field key is a short lowercase name, not ${JSON.stringify(key)}`);
    return `  <label>${escape(label)} <input type="text" name="metadata__${key}" autocomplete="${key === "name" ? "name" : "off"}"></label>\n`;
  }).join("");
  const hidden = tags.map((tag) => `  <input type="hidden" name="tag" value="${escape(tagName(tag))}">\n`).join("");
  return `<form${formId} action="https://buttondown.com/api/emails/embed-subscribe/${newsletter}" method="post" class="embeddable-buttondown-form">\n`
    + `  <label>Email <input type="email" name="email" required autocomplete="email"></label>\n${extra}${hidden}`
    + `  <input type="hidden" value="1" name="embed">\n  <button type="submit">${escape(button)}</button>\n</form>\n`;
}

// Newsletters: a key is scoped to one newsletter, so `GET /v1/newsletters` with it lists that newsletter;
// `PATCH /v1/newsletters/{id}` sets its `name`, `description`, `from_name` and `reply_to_address` (Buttondown's
// OpenAPI document, read 2026-10-02).

/** The fields the house keeps in step with a persona: the newsletter's name, description, sender and reply-to. */
export const NEWSLETTER_PROFILE_FIELDS = Object.freeze(["name", "description", "from_name", "reply_to_address"]);

/**
 * The newsletter a key belongs to.
 * @param {{token: string, fetch: typeof fetch}} input
 * @returns {Promise<{id: string, username: string, name: string, description: string, from_name: string, reply_to_address: string}>}
 */
export async function keyNewsletter({ token, fetch: fetchImpl } = {}) {
  const call = capability(fetchImpl, "keyNewsletter");
  const page = await json(await call(apiUrl("/newsletters"), { method: "GET", redirect: "error", headers: { accept: "application/json", authorization: tokenHeader(token) } }), "newsletters.list");
  const [newsletter, ...others] = Array.isArray(page?.results) ? page.results : [];
  if (!newsletter?.id || typeof newsletter.username !== "string") throw new TypeError("the Buttondown key names no newsletter");
  if (others.length) throw new TypeError(`the Buttondown key reaches ${others.length + 1} newsletters; a house key is scoped to one`);
  return Object.fromEntries(["id", "username", ...NEWSLETTER_PROFILE_FIELDS].map((field) => [field, newsletter[field] ?? ""]));
}

/**
 * Set a newsletter's profile fields that differ from `profile`; returns the fields changed.
 * @param {{token: string, fetch: typeof fetch, newsletter: {id: string}, profile: Partial<Record<"name"|"description"|"from_name"|"reply_to_address", string>>}} input
 */
export async function alignNewsletterProfile({ token, fetch: fetchImpl, newsletter, profile } = {}) {
  const call = capability(fetchImpl, "alignNewsletterProfile");
  const changes = Object.fromEntries(Object.entries(profile ?? {}).filter(([field, value]) => NEWSLETTER_PROFILE_FIELDS.includes(field) && typeof value === "string" && value && newsletter[field] !== value));
  if (!Object.keys(changes).length) return [];
  await json(await call(apiUrl(`/newsletters/${encodeURIComponent(newsletter.id)}`), { method: "PATCH", redirect: "error", headers: { "content-type": "application/json", accept: "application/json", authorization: tokenHeader(token) }, body: JSON.stringify(changes) }), "newsletters.update");
  return Object.keys(changes);
}
