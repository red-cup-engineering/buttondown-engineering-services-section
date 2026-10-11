import { readFile } from "node:fs/promises";
import { createDraftEmail } from "../src/buttondown.mjs";
import { newsletterKey } from "../src/newsletter-keys.mjs";

/**
 * Create a Buttondown draft (or scheduled) email in one newsletter from a
 * rendered issue Markdown file and a metadata JSON file. The newsletter's
 * key is read from its key file (newsletter-keys.mjs).
 *
 * metadata.json shape: `{"subject": string, "status"?: "draft"|"scheduled", "publishDate"?: string}`
 *
 * @param {string[]} argv - [newsletter, issuePath, metadataPath]
 * @param {{token?: string}} [options] - an injected key; read from the newsletter's key file when absent
 * @returns {Promise<{id: string, subject: string, status: string, publishDate: string|null, response: unknown}>}
 * @throws {Error} if no key is held for the newsletter, or if an argument is missing
 */
export async function createButtondownDraftFromFiles([newsletter, issuePath, metadataPath] = [], { token } = {}) {
  if (!newsletter || !issuePath || !metadataPath) throw new Error("usage: create-buttondown-draft.mjs <newsletter> <issue.md> <metadata.json>");
  const key = token ?? await newsletterKey(newsletter);
  const body = await readFile(issuePath, "utf8");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  return createDraftEmail({ token: key, fetch, subject: metadata.subject, body, status: metadata.status, publishDate: metadata.publishDate });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await createButtondownDraftFromFiles(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
}
