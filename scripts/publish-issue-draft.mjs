#!/usr/bin/env node
/**
 * @module publish-issue-draft
 * Verify + re-compose an issue directory's three renderings, create a
 * Buttondown DRAFT from the composed Markdown, and record a receipt.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { composeIssue } from "@red-cup-engineering/email-newsletter-engineering-services-section/scripts/compose-issue.mjs";
import { createDraftEmail } from "../src/buttondown.mjs";
import { newsletterKey } from "../src/newsletter-keys.mjs";

const RENDERING_NAMES = Object.freeze(["issue.md", "issue.paste.html"]);

/**
 * @param {string} issueDir
 * @returns {{path: string, format: "rss"|"atom"}|null} the existing
 *   feed-item rendering, or null when neither extension is present
 */
function locateFeedItemRendering(issueDir) {
  const rss = join(issueDir, "issue.feed-item.rss.xml");
  if (existsSync(rss)) return { path: rss, format: "rss" };
  const atom = join(issueDir, "issue.feed-item.atom.xml");
  if (existsSync(atom)) return { path: atom, format: "atom" };
  return null;
}

/**
 * Verify the three renderings already exist in `issueDir`, throwing a
 * single message naming every rendering that is missing.
 * @param {string} issueDir
 * @returns {"rss"|"atom"} the feed-item format found on disk
 * @throws {Error} when any of the three renderings is absent
 */
function verifyRenderingsExist(issueDir) {
  const missing = RENDERING_NAMES.filter((name) => !existsSync(join(issueDir, name)));
  const feedItem = locateFeedItemRendering(issueDir);
  if (feedItem === null) missing.push("issue.feed-item.{rss,atom}.xml");
  if (missing.length > 0) {
    throw new Error(`publish-issue-draft: ${issueDir} is missing rendering(s) — ${missing.join(", ")}; compose the issue at least once before publishing`);
  }
  return feedItem.format;
}

/**
 * Find the single issue JSON file inside `issueDir` (any `*.json` file:
 * the three renderings are `.md`/`.html`/`.xml`, never `.json`).
 * @param {string} issueDir
 * @returns {Promise<string>} absolute path to the issue JSON file
 * @throws {Error} when zero or more than one `*.json` file is found
 */
async function locateIssueJson(issueDir) {
  const entries = await readdir(issueDir, { withFileTypes: true });
  const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name);
  if (jsonFiles.length === 0) throw new Error(`publish-issue-draft: ${issueDir} contains no issue *.json file`);
  if (jsonFiles.length > 1) throw new Error(`publish-issue-draft: ${issueDir} contains more than one *.json file — ${jsonFiles.join(", ")}`);
  return join(issueDir, jsonFiles[0]);
}

/**
 * Publish one issue directory: verify + re-compose its three renderings,
 * create a Buttondown DRAFT from the freshly composed Markdown, and record
 * a dated publication receipt. Refuses cleanly, before any network call,
 * without the newsletter's key.
 * @param {string} issueDir - path to an issue directory (e.g. `content/issues/001`)
 * @param {object} [options]
 * @param {string} options.feedLink - the publication's RSS/Atom issue URL
 * @param {string} [options.publishDate] - ISO 8601 instant for the feed item; defaults to now
 * @param {"draft"|"scheduled"} [options.status] - Buttondown creation status; defaults to "draft"
 * @param {string} [options.scheduledPublishDate] - required ISO 8601 instant when status is "scheduled"
 * @param {string} options.token - the newsletter's Buttondown key (newsletter-keys.mjs resolves it from the routing name)
 * @param {typeof fetch} [options.fetchImpl] - injected fetch capability; defaults to global fetch
 * @param {string} [options.dataRoot] - publication data directory; defaults to `<issue-dir>/data`
 * @returns {Promise<{issueDir: string, issueTitle: string, files: {markdown: string, pasteHtml: string, feedItem: string}, draft: object, receipt: object}>}
 * @throws {Error} when a rendering is missing, the issue JSON is not exactly one file,
 *   the issue fails validation, or no key is given
 */
export async function publishIssueDraft(issueDir, options = {}) {
  const {
    feedLink,
    publishDate,
    status,
    scheduledPublishDate,
    token,
    fetchImpl = fetch,
    dataRoot = join(resolve(issueDir), "data"),
  } = options;

  const resolvedIssueDir = resolve(issueDir);
  const format = verifyRenderingsExist(resolvedIssueDir);
  const issueJsonPath = await locateIssueJson(resolvedIssueDir);
  const issue = JSON.parse(readFileSync(issueJsonPath, "utf8"));

  // A refused submission must leave the caller's reviewed source and dated
  // renderings untouched. Validate effect preconditions before composeIssue writes.
  if (!feedLink) throw new Error("publish-issue-draft: feedLink is required");
  if (!token) throw new Error("publish-issue-draft: no Buttondown key for this newsletter; refusing to create a Buttondown draft");
  const link = feedLink;
  const { files } = composeIssue(issue, resolvedIssueDir, { link, pubDate: publishDate, format });

  const body = readFileSync(files.markdown, "utf8");
  const draft = await createDraftEmail({
    token,
    fetch: fetchImpl,
    subject: issue.title,
    body,
    status,
    publishDate: scheduledPublishDate,
  });

  const recordedAt = new Date().toISOString();
  mkdirSync(dataRoot, { recursive: true });
  const receipt = { recordedAt, issueDir: resolvedIssueDir, issueTitle: issue.title, feedLink: link, files, draft };
  appendFileSync(join(dataRoot, "publications.jsonl"), JSON.stringify(receipt) + "\n", { mode: 0o600 });

  return { issueDir: resolvedIssueDir, issueTitle: issue.title, files, draft, receipt };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "feed-link": { type: "string" },
      "publish-date": { type: "string" },
      status: { type: "string" },
      "scheduled-publish-date": { type: "string" },
      "data-root": { type: "string" },
      newsletter: { type: "string" },
    },
    allowPositionals: true,
  });
  const [issueDir] = positionals;
  if (!issueDir || !values.newsletter) {
    console.error("usage: publish-issue-draft.mjs <issue-dir> --newsletter <name> [--feed-link <url>] [--publish-date <iso>] [--status draft|scheduled] [--scheduled-publish-date <iso>] [--data-root <path>]");
    process.exitCode = 2;
  } else {
    try {
      const result = await publishIssueDraft(issueDir, {
        feedLink: values["feed-link"],
        publishDate: values["publish-date"],
        status: values.status,
        scheduledPublishDate: values["scheduled-publish-date"],
        dataRoot: values["data-root"] ? resolve(values["data-root"]) : undefined,
        token: await newsletterKey(values.newsletter),
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error.message ?? error);
      process.exitCode = 1;
    }
  }
}
