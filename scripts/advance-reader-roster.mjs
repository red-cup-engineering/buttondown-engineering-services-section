#!/usr/bin/env node
/**
 * Write a newsletter's advance-reader team as a private review-copy roster: every confirmed subscriber tagged
 * `advance-reader-team`, as `[{name, email, reference}]`, the roster kindle-publishing-system's
 * grant-review-copies.mjs takes with --roster. The roster holds addresses, so it is written 0600 under
 * $XDG_STATE_HOME/561-group/review-copies/rosters/ (never into git) and only its path and size are printed.
 *
 *   advance-reader-roster --newsletter <name> [--tag advance-reader-team] [--out <file>]
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ADVANCE_READER_TAG, advanceReaderRoster } from "../src/buttondown.mjs";
import { newsletterKey } from "../src/newsletter-keys.mjs";

const { values } = parseArgs({ options: { newsletter: { type: "string" }, tag: { type: "string", default: ADVANCE_READER_TAG }, out: { type: "string" } } });
if (!values.newsletter) throw new Error("usage: advance-reader-roster --newsletter <name> [--tag <tag>] [--out <file>]");
const roster = await advanceReaderRoster({ token: await newsletterKey(values.newsletter), fetch, newsletter: values.newsletter, tag: values.tag });
const home = process.env.HOME ?? homedir();
const out = resolve(values.out ?? join(process.env.XDG_STATE_HOME ?? join(home, ".local", "state"), "561-group", "review-copies", "rosters", `${values.newsletter}-${new Date().toISOString().slice(0, 10)}.json`));
await mkdir(dirname(out), { recursive: true, mode: 0o700 });
await writeFile(out, `${JSON.stringify(roster, null, 2)}\n`, { mode: 0o600 });
await chmod(out, 0o600);
process.stdout.write(`${JSON.stringify({ newsletter: values.newsletter, tag: values.tag, readers: roster.length, roster: out }, null, 2)}\n`);
