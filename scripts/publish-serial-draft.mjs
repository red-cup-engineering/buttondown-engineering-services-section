#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { lintManuscript } from "@red-cup-engineering/ebook-engineering-services-section/lint-manuscript";
import { fictionIssueFromEpisode, validateSerialManifest } from "@red-cup-engineering/email-newsletter-engineering-services-section/fiction-serial";
import { composeIssue } from "@red-cup-engineering/email-newsletter-engineering-services-section/scripts/compose-issue.mjs";
import { createDraftEmail } from "../src/buttondown.mjs";
import { readNewsletterKey } from "../src/newsletter-keys.mjs";

const EPISODE_FILE = /^(\d+)-.+\.md$/u;

function digest(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function readRecords(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

/**
 * Publish the next episode not represented by a real Buttondown draft record.
 * `token` is the key of the manifest's `buttondownNewsletter` (the CLI reads it
 * with newsletter-keys.mjs). A missing key is an admitted dry run: lint/render still happen and a record
 * with mode "dry-run" and draftId null is appended without touching network.
 */
export async function publishSerialDraft(serialDir, {
  token = null,
  fetchImpl = fetch,
  now = () => new Date(),
  feedBaseUrl,
  dataRoot,
} = {}) {
  const root = resolve(serialDir);
  const manifestPath = join(root, "serial.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const manifestReport = validateSerialManifest(manifest);
  if (!manifestReport.valid) throw new TypeError(`publish-serial-draft: ${manifestReport.findings.map((finding) => finding.message).join("; ")}`);
  const storyBible = JSON.parse(readFileSync(resolve(root, manifest.canon), "utf8"));
  const entries = await readdir(root, { withFileTypes: true });
  const episodes = entries
    .filter((entry) => entry.isFile() && EPISODE_FILE.test(entry.name))
    .map((entry) => ({ number: Number(entry.name.match(EPISODE_FILE)[1]), path: join(root, entry.name) }))
    .sort((left, right) => left.number - right.number);
  if (episodes.length === 0) throw new Error("publish-serial-draft: serial has no numbered episode Markdown files");

  const recordsRoot = resolve(dataRoot ?? join(root, "data", "records"));
  const recordsPath = join(recordsRoot, "publications.jsonl");
  const drafted = new Set(readRecords(recordsPath).filter((record) => record.mode === "draft" && record.draftId).map((record) => record.episode));
  const target = episodes.find((episode) => !drafted.has(episode.number));
  if (!target) throw new Error("publish-serial-draft: every episode already has a Buttondown draft record");

  const throughTarget = episodes.filter((episode) => episode.number <= target.number);
  const chapters = throughTarget.map((episode) => ({ path: episode.path, text: readFileSync(episode.path, "utf8") }));
  const lint = lintManuscript(chapters, { profile: "fiction", storyBible, serialInProgress: true });
  if (!lint.ok) {
    const errors = lint.findings.filter((finding) => finding.severity === "error").map((finding) => `${basename(finding.path ?? "serial")}: ${finding.rule}: ${finding.message}`);
    throw new Error(`publish-serial-draft: fiction lint failed — ${errors.join("; ")}`);
  }

  const episodeText = readFileSync(target.path, "utf8");
  const issue = fictionIssueFromEpisode({ manifest, storyBible, episodeText });
  if (issue.episode !== target.number) throw new Error(`publish-serial-draft: filename episode ${target.number} disagrees with frontmatter episode ${issue.episode}`);
  const outputDir = join(dirname(recordsRoot), "rendered", `episode-${String(issue.episode).padStart(3, "0")}`);
  const link = feedBaseUrl ? `${feedBaseUrl.replace(/\/$/u, "")}/${issue.episode}` : `urn:fiction-serial:${encodeURIComponent(manifest.serial)}:${issue.episode}`;
  const time = now().toISOString();
  const { files } = composeIssue(issue, outputDir, { link, guid: link, pubDate: time });

  const subject = `${issue.serial} — ${issue.episode}. ${issue.title}`;
  const draft = token ? await createDraftEmail({
    token,
    fetch: fetchImpl,
    subject,
    body: readFileSync(files.markdown, "utf8"),
    status: "draft",
    emailType: issue.access === "paid" ? "premium" : "public",
  }) : null;
  const record = {
    kind: "red-cup-engineering.fiction-serial-publication",
    serial: manifest.serial,
    buttondownNewsletter: manifest.buttondownNewsletter,
    episode: issue.episode,
    access: issue.access,
    episodeDigest: `sha256:${digest(episodeText)}`,
    draftId: draft?.id ?? null,
    time,
    mode: draft ? "draft" : "dry-run",
    files,
  };
  mkdirSync(recordsRoot, { recursive: true });
  appendFileSync(recordsPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  return { manifest, issue, lint, files, draft, record, recordsPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { "feed-base-url": { type: "string" }, "data-root": { type: "string" } },
    allowPositionals: true,
  });
  if (!positionals[0]) {
    console.error("usage: publish-serial-draft.mjs <serial-dir> [--feed-base-url <url>] [--data-root <records-dir>]");
    process.exitCode = 2;
  } else {
    try {
      const { buttondownNewsletter } = JSON.parse(readFileSync(join(resolve(positionals[0]), "serial.json"), "utf8"));
      const token = await readNewsletterKey(buttondownNewsletter);
      console.log(JSON.stringify(await publishSerialDraft(positionals[0], { token, feedBaseUrl: values["feed-base-url"], dataRoot: values["data-root"] }), null, 2));
    } catch (error) {
      console.error(error.message ?? error);
      process.exitCode = 1;
    }
  }
}
