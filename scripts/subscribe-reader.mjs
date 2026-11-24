#!/usr/bin/env node
/**
 * Join one reader to a newsletter on their own request: a reply asking to join, or asking for the advance-reader
 * team. Buttondown sends its confirmation email to a new or unsubscribed address; a suppressed address is left
 * alone. --consent says how the reader asked and is kept on the subscriber as the evidence of it. Prints the
 * disposition, never the address.
 *
 *   subscribe-reader --newsletter <name> --email <address> --consent <how they asked> [--name <name>] [--tag <tag>]... [--advance-reader-team]
 */
import { parseArgs } from "node:util";
import { ADVANCE_READER_TAG, subscribe } from "../src/buttondown.mjs";
import { newsletterKey } from "../src/newsletter-keys.mjs";

const usage = "usage: subscribe-reader --newsletter <name> --email <address> --consent <how they asked> [--name <name>] [--tag <tag>]... [--advance-reader-team]";
const { values } = parseArgs({ options: { newsletter: { type: "string" }, email: { type: "string" }, consent: { type: "string" }, name: { type: "string" }, tag: { type: "string", multiple: true, default: [] }, "advance-reader-team": { type: "boolean", default: false } } });
if (!values.newsletter || !values.email || !values.consent) throw new Error(usage);
const tags = [...values.tag, ...(values["advance-reader-team"] ? [ADVANCE_READER_TAG] : [])];
const result = await subscribe({ token: await newsletterKey(values.newsletter), fetch, email: values.email, consent: values.consent, tags, metadata: values.name ? { name: values.name } : {} });
process.stdout.write(`${JSON.stringify({ newsletter: values.newsletter, disposition: result.disposition, subscriber: result.subscriber?.id ?? null, tags: result.subscriber?.tags ?? [] }, null, 2)}\n`);
