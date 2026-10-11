import assert from "node:assert/strict";
import test from "node:test";
import { EMAIL_STATUS_STATES, buildCreateEmailRequest, classifyEmailStatus } from "../src/buttondown.mjs";

test("every Buttondown email status maps to a delivery state", () => {
  const expected = {
    draft: "draft", managed_by_rss: "provider-managed", imported: "provider-managed",
    scheduled: "delivery-pending", about_to_send: "delivery-pending",
    in_flight: "delivery-active", throttled: "delivery-active", resending: "delivery-active",
    paused: "delivery-obstructed", errored: "delivery-obstructed", partially_sent: "partially-sent",
    transactional: "transactional", suppressed: "suppressed", sent: "sent", deleted: "deleted",
  };
  for (const [status, state] of Object.entries(expected)) assert.equal(classifyEmailStatus(status), state);
  assert.deepEqual(Object.keys(EMAIL_STATUS_STATES).sort(), Object.keys(expected).sort());
});

test("an unknown status is refused rather than guessed", () => {
  assert.throws(() => classifyEmailStatus("archived"), /unknown Buttondown email status/u);
  assert.throws(() => classifyEmailStatus("toString"), /unknown Buttondown email status/u);
});

test("the draft request stays draft-only and credential-blind", () => {
  const { init } = buildCreateEmailRequest({ subject: "North Shore field note", body: "Draft body" });
  assert.equal("authorization" in init.headers, false);
  assert.deepEqual(JSON.parse(init.body), { subject: "North Shore field note", body: "Draft body", status: "draft", email_type: "public" });
  assert.throws(() => buildCreateEmailRequest({ subject: " ", body: "b" }), /nonempty subject/u);
});
