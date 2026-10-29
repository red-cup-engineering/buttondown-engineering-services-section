import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { publishIssueDraft } from "../scripts/publish-issue-draft.mjs";
import { renderMarkdown, renderPasteHtml } from "@red-cup-engineering/email-newsletter-engineering-services-section";

const FIXTURES_ROOT = fileURLToPath(new URL("./fixtures/issues", import.meta.url));

function tempCopyOf(fixtureName) {
  const workRoot = mkdtempSync(join(tmpdir(), "health-education-newsletter-"));
  const issueDir = join(workRoot, fixtureName);
  cpSync(join(FIXTURES_ROOT, fixtureName), issueDir, { recursive: true });
  return { workRoot, issueDir, dataRoot: join(workRoot, "data") };
}

function fetchSpy(calls, response = { id: "draft-fixture-1", status: "draft", publish_date: null }) {
  return async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ...response, subject: JSON.parse(init.body).subject }),
    };
  };
}

test("recomposes stale renderings, creates a Buttondown draft, and records a receipt", async () => {
  const { workRoot, issueDir, dataRoot } = tempCopyOf("001-valid");
  try {
    const issue = JSON.parse(readFileSync(join(issueDir, "issue-001.json"), "utf8"));
    const calls = [];
    const result = await publishIssueDraft(issueDir, {
      feedLink: "https://fixture.example/issues/001-valid",
      publishDate: "2026-01-01T00:00:00.000Z",
      token: "fixture-token",
      fetchImpl: fetchSpy(calls),
      dataRoot,
    });

    assert.equal(readFileSync(result.files.markdown, "utf8"), renderMarkdown(issue));
    assert.equal(readFileSync(result.files.pasteHtml, "utf8"), renderPasteHtml(issue));
    assert.doesNotMatch(readFileSync(result.files.markdown, "utf8"), /STALE/u);

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/emails$/u);
    assert.equal(calls[0].init.headers.authorization, "Token fixture-token");
    assert.equal(JSON.parse(calls[0].init.body).subject, issue.title);

    assert.equal(result.draft.id, "draft-fixture-1");
    const saved = JSON.parse(readFileSync(join(dataRoot, "publications.jsonl"), "utf8").trim());
    assert.equal(saved.draft.id, result.draft.id);
    assert.equal(saved.issueTitle, issue.title);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

test("refuses cleanly, before any network call, without the newsletter's key", async () => {
  const { workRoot, issueDir, dataRoot } = tempCopyOf("001-valid");
  try {
    const names = ["issue.md", "issue.paste.html", "issue.feed-item.rss.xml"];
    const before = names.map((name) => readFileSync(join(issueDir, name), "utf8"));
    const calls = [];
    const refusingFetch = async () => {
      calls.push(true);
      throw new Error("fetch must not be called without a key");
    };
    await assert.rejects(
      () => publishIssueDraft(issueDir, {
        feedLink: "https://fixture.example/issues/001-valid",
        token: undefined,
        fetchImpl: refusingFetch,
        dataRoot,
      }),
      /no Buttondown key/u,
    );
    assert.equal(calls.length, 0);
    assert.deepEqual(
      names.map((name) => readFileSync(join(issueDir, name), "utf8")),
      before,
      "denied publication must not rewrite approved source previews or their feed dates",
    );
    assert.equal(existsSync(dataRoot), false, "no draft receipt or empty publication directory");
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

test("throws naming every missing rendering, and never reaches Buttondown", async () => {
  const { workRoot, issueDir, dataRoot } = tempCopyOf("002-missing-rendering");
  try {
    const calls = [];
    await assert.rejects(
      () => publishIssueDraft(issueDir, {
        token: "fixture-token",
        fetchImpl: fetchSpy(calls),
        dataRoot,
      }),
      /missing rendering\(s\).*issue\.paste\.html.*issue\.feed-item/su,
    );
    assert.equal(calls.length, 0);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

test("throws when the issue directory carries more than one *.json file", async () => {
  const { workRoot, issueDir, dataRoot } = tempCopyOf("001-valid");
  try {
    writeFileSync(join(issueDir, "extra.json"), "{}");
    await assert.rejects(
      () => publishIssueDraft(issueDir, { token: "fixture-token", dataRoot }),
      /more than one \*\.json file/u,
    );
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});
