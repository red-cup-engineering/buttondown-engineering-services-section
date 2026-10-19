import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { publishSerialDraft } from "../scripts/publish-serial-draft.mjs";

const sourceFixture = fileURLToPath(new URL("./fixtures/fiction-serial", import.meta.url));

function fixtureCopy() {
  const workRoot = mkdtempSync(join(tmpdir(), "fiction-serial-publish-"));
  const serialDir = join(workRoot, "glass-harbor");
  cpSync(sourceFixture, serialDir, { recursive: true });
  return { workRoot, serialDir, recordsRoot: join(serialDir, "data", "records") };
}

test("without a key the next episode lints, renders all targets, and records a dry run", async () => {
  const { workRoot, serialDir, recordsRoot } = fixtureCopy();
  const calls = [];
  try {
    const result = await publishSerialDraft(serialDir, {
      token: null,
      fetchImpl: async () => { calls.push(true); throw new Error("dry run must not fetch"); },
      now: () => new Date("2026-09-27T12:00:00.000Z"),
      feedBaseUrl: "https://example.test/glass-harbor",
    });
    assert.equal(result.issue.episode, 1);
    assert.equal(result.lint.ok, true);
    assert.equal(result.record.mode, "dry-run");
    assert.equal(result.record.draftId, null);
    assert.match(result.record.episodeDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(calls, []);
    assert.ok(existsSync(result.files.markdown));
    assert.ok(existsSync(result.files.pasteHtml));
    assert.ok(existsSync(result.files.feedItem));
    const saved = JSON.parse(readFileSync(join(recordsRoot, "publications.jsonl"), "utf8").trim());
    assert.equal(saved.time, "2026-09-27T12:00:00.000Z");
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

test("the next unpublished paid episode creates only a premium Buttondown draft", async () => {
  const { workRoot, serialDir, recordsRoot } = fixtureCopy();
  const calls = [];
  try {
    mkdirSync(recordsRoot, { recursive: true });
    writeFileSync(join(recordsRoot, "publications.jsonl"), [1, 2].map((episode) => JSON.stringify({ episode, mode: "draft", draftId: `prior-${episode}` })).join("\n") + "\n");
    const result = await publishSerialDraft(serialDir, {
      token: "fixture-token",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: "draft-3", subject: JSON.parse(init.body).subject, status: "draft", publish_date: null }), { status: 200 });
      },
      now: () => new Date("2026-09-27T13:00:00.000Z"),
    });
    assert.equal(result.issue.episode, 3);
    assert.equal(result.issue.access, "paid");
    assert.equal(result.record.draftId, "draft-3");
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].init.body).email_type, "premium");
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});
