# @red-cup-engineering/buttondown-services-section

Credential-blind Buttondown platform API client — the org's
newsletter-delivery rail. Seated as the publishing-platform sibling of
`youtube-services-section` under `web2-platform-services-section`; no
publishing/newsletter child section existed under it, so this section
seats directly at `web2-platform-services-section/services/buttondown-services-section`
(no deeper taxonomy invented).

`src/buttondown.mjs` exports pure request-building and response-normalizing
functions and credential-blind operations, each taking `{token, fetch}` as
explicit parameters: `createDraftEmail`, `sendEmail`, `listSubscribers`,
`subscriberCounts`, and for readers `getSubscriber`, `subscribe`,
`taggedSubscribers`, `advanceReaderRoster` and `embedSubscribeForm`. The module
never reads `process.env` or embeds a credential.

`classifyEmailStatus` reads the `status` of a normalized email into a delivery state (`draft`, `provider-managed`, `delivery-pending`, `delivery-active`, `delivery-obstructed`, `partially-sent`, `transactional`, `suppressed`, `sent`, `deleted`) and refuses a status it has not been read to define.

## One key per newsletter

Each newsletter the house runs (one per persona, one per serial) has its own
Buttondown account and key. `src/newsletter-keys.mjs` resolves a newsletter's
routing name — a persona's `buttondown` presence, a serial manifest's
`buttondownNewsletter` — to `~/.config/561-group/buttondown/<newsletter>.api-key`,
a 0600 file holding the key alone. persona-provision writes it when it makes
the newsletter. No script reads a process-wide key.

## Readers

Bulk mail goes only through Buttondown, which carries the footer, unsubscribe,
bounces and double opt-in. A reader joins on their own request, and nobody is
mailed before confirming:

- **On a page**: `embedSubscribeForm({newsletter, tags, fields})` is a plain
  HTML form posting to Buttondown's embed-subscribe endpoint, which runs the
  newsletter's double opt-in. Hidden `tag` inputs carry tags; `metadata__<key>`
  fields carry what the reader gives (a name for their review copy).
- **By link**: `subscribePageUrl({newsletter, tags})` is the newsletter's
  hosted subscribe page with each tag as a `tag` query parameter, for pages
  that carry links rather than HTML (the author sites' markdown).
- **By reply**: `subscribe({email, consent, tags, metadata})` creates a new
  address as `unactivated`, so Buttondown sends its confirmation; re-invites an
  unsubscribed address through a new confirmation rather than resubscribing it;
  leaves a suppressed address (blocked, complained, undeliverable, removed)
  alone; and otherwise only adds the tags. `consent` says how the reader asked
  and is kept in the subscriber's metadata. `subscribe-reader` is the CLI.

Joining the advance-reader team is a second, explicit choice: the
`advance-reader-team` tag (`ADVANCE_READER_TAG`). `advanceReaderRoster` lists
the confirmed subscribers carrying it as `[{name, email, reference}]`, the
reference being `<newsletter>/<subscriber id>` so a repeated grant run gives
nobody a second copy. `advance-reader-roster --newsletter <name>` writes that
roster 0600 under `$XDG_STATE_HOME/561-group/review-copies/rosters/` for
kindle-publishing-system's `grant-review-copies --roster`. Addresses never
enter git or a printed line.

## Verified facts (from docs.buttondown.com)

Fetched 2026-09-01. Quoted/paraphrased facts below are what each cited
page actually stated; anything not confirmed in a fetched page is
labeled as inference in the source code's JSDoc, not claimed as verified.

- **Base URL and versioning**: `https://api.buttondown.com/v1/...`
  (https://docs.buttondown.com/api-authentication references
  `GET /v1/newsletters` and `GET /v1/subscribers`).
- **Authentication**: "Clients should authenticate by passing the token
  key in the `Authorization` HTTP header, prepended with the string
  `Token `" — i.e. `Authorization: Token <api-key>`
  (https://docs.buttondown.com/api-authentication). API keys are managed
  at https://buttondown.com/keys.
- **Creating an email**: `POST /v1/emails` with a JSON body
  `{"subject": ..., "body": ..., "status": "draft"}`
  (https://docs.buttondown.com/api-emails-create). Buttondown
  "automatically detects whether your content is Markdown or rich HTML
  and handles it appropriately"; plaintext/Markdown is the default mode.
  A body starting with `---` triggers a `400 body_contains_frontmatter`
  error unless the `X-Buttondown-Live-Dangerously: true` header is sent
  (not implemented by this client — issue bodies are expected not to
  start with a YAML frontmatter block).
- **Paid audience**: the email API's `email_type` admits `public`, `private`
  and `premium`; Buttondown documents premium emails as reaching only paying,
  gifted or trial subscribers. Fiction issue access maps `free` to `public`
  and `paid` to `premium`. The API now calls this field a legacy projection of
  archive visibility and audience filters, but continues to admit it.
- **Scheduling an email**: add `"status": "scheduled"` and
  `"publish_date"` in ISO 8601
  (https://docs.buttondown.com/scheduling-emails-via-the-api).
- **Email statuses**: the status workflow diagram
  (https://docs.buttondown.com/api-emails-status,
  https://docs.buttondown.com/scheduling-emails-via-the-api) names
  Draft, Scheduled, About to send, In flight, Paused, Throttled, Sent,
  Resending, and Managed by RSS; `EMAIL_CREATE_STATUSES` in this client
  covers only the two statuses documented as settable at creation time
  (`draft`, `scheduled`).
- **Sending a draft**: `POST /v1/emails/{id}/send-draft`
  (https://docs.buttondown.com/api-emails-send-draft). This page did not
  render an example response body; `sendEmail`/`normalizeSendEmailResponse`
  tolerate an empty body and anchor identity on the requested `emailId`.
- **Subscribers** (Buttondown's OpenAPI document,
  https://api.buttondown.com/v1/openapi.json, read 2026-10-02):
  `GET /v1/subscribers` returns a `SubscriberPage` (`count`/`next`/
  `previous`/`results`) and takes a `tag` filter; each `Subscriber` carries
  `id`, `email_address`, `type`, `tags` (names) and `metadata`.
  `GET`/`PATCH /v1/subscribers/{id_or_email}` take an id or an address.
  `POST /v1/subscribers` takes `email_address`, `type`, `tags` (created on
  first use), `metadata` and `referrer_url`; "Newly created subscribers are
  subject to double opt-in — they will receive an email asking them to confirm
  their subscription, and have a state of `unactivated` until they do so"
  (https://docs.buttondown.com/api-subscribers-create). With
  `X-Buttondown-Collision-Behavior: add` and `type: "unactivated"`, an
  unsubscribed address is re-invited "as unactivated and sends a new
  confirmation email"; without the header a duplicate address is a 400.
- **Embed form** (https://docs.buttondown.com/building-your-subscriber-base):
  a plain POST form to Buttondown's embed-subscribe endpoint; a hidden `tag`
  input tags the subscriber and `metadata__<key>` inputs set metadata.
- **Subscriber types**: the state diagram
  (https://docs.buttondown.com/api-subscribers-type) names Unactivated,
  Regular, Unpaid, Premium, Trialed, Gifted, Churning, Paused,
  Unsubscribed, Undeliverable, Complained, Past due, and Churned; "The
  only types that can be set programmatically are REGULAR, UNSUBSCRIBED,
  GIFTED and UNPAID" — captured as `SUBSCRIBER_PROGRAMMATIC_TYPES`.
- **Paid subscriptions run on a connected Stripe account**:
  https://docs.buttondown.com/stripe states "Getting started requires
  you to register and connect a Stripe account to Buttondown; it can be
  a pre-existing account or a new one." https://docs.buttondown.com/paid-subscriptions
  states Buttondown "works with Stripe to automate payments and taxes,"
  that creators "keep all of the money [they] make after credit card
  fees," and that Buttondown "will automatically detect the new
  subscriptions and create paid subscribers" from a Stripe Payment Link.
  The exact phrase "Stripe Connect" was not found in the fetched pages,
  but the described mechanism — a creator's own Stripe account
  registered to Buttondown, which then reads Stripe subscription events
  — is Stripe's connected-account model. This client does not touch
  Stripe directly; it is out of scope for the emails/subscribers surface
  built here.

## Not done here

- No newsletter key is held yet; persona-provision makes Sigrid Song's
  newsletter (`sigridsong`) and its key.
- Not published to the registry.

## Usage

```js
import { createDraftEmail, listSubscribers, sendEmail, subscriberCounts } from "@red-cup-engineering/buttondown-services-section";

const draft = await createDraftEmail({ token, fetch, subject: "Issue #1", body: "# Hello\n\nMarkdown body." });
await sendEmail({ token, fetch, emailId: draft.id });
const page = await listSubscribers({ token, fetch });
const counts = await subscriberCounts({ token, fetch });
```

```sh
node scripts/create-buttondown-draft.mjs <newsletter> issue.md metadata.json
echo '{"newsletter":"sigridsong"}' | node scripts/list-buttondown-subscribers.mjs
node scripts/publish-issue-draft.mjs <issue-dir> --newsletter <name> --feed-link <url>
node scripts/subscribe-reader.mjs --newsletter sigridsong --email <address> --consent "<how they asked>" --advance-reader-team
node scripts/advance-reader-roster.mjs --newsletter sigridsong
```

For fiction serials, `publish-fiction-serial-draft <serial-dir>` selects the
next episode without a real draft receipt, lints the episodes to date through
the ebook section's open-serial fiction profile, renders all three newsletter
targets, and creates a Buttondown draft. Free issues become `public` emails;
paid issues become `premium` emails. `sendEmail` remains a separate explicit
operation and this command never calls it. The serial manifest's
`buttondownNewsletter` is the stable routing name whose key file the command
reads; the name itself is never a credential.

When no key is held for that newsletter the same command performs a dry run: no
network call occurs, rendering still completes, and a record with the episode
SHA-256 digest, null draft id and time is appended beneath
`data/records/publications.jsonl`. Dry-run records do not make an episode count
as published.

## Tests

`npm test` — plain `node --test`, no network, hand-built doc-derived
fixtures, including the three-episode fiction serial and its dry-run record.
