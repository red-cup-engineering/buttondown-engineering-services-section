import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * One API key per Buttondown newsletter. A newsletter's routing name (a persona's `buttondown` presence, a serial
 * manifest's `buttondownNewsletter`) resolves to `~/.config/561-group/buttondown/<newsletter>.api-key`, a 0600 file
 * holding the key and nothing else. The key never enters git, a record or a process-wide environment variable.
 */

export const NEWSLETTER_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

function newsletterName(newsletter) {
  if (typeof newsletter !== "string" || !NEWSLETTER_NAME.test(newsletter)) throw new TypeError(`a Buttondown newsletter is named by a stable lowercase routing name, not ${JSON.stringify(newsletter)}`);
  return newsletter;
}

/** Where a newsletter's key lives. */
export function newsletterKeyPath(newsletter, { home = process.env.HOME ?? homedir() } = {}) {
  return join(home, ".config", "561-group", "buttondown", `${newsletterName(newsletter)}.api-key`);
}

/** The newsletter's key, or null when none is held yet. */
export async function readNewsletterKey(newsletter, options = {}) {
  try {
    const key = (await readFile(newsletterKeyPath(newsletter, options), "utf8")).trim();
    return key || null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** The newsletter's key; refuses when none is held. */
export async function newsletterKey(newsletter, options = {}) {
  const key = await readNewsletterKey(newsletter, options);
  if (!key) throw new Error(`no Buttondown key is held for ${newsletter}; persona-provision makes one (${newsletterKeyPath(newsletter, options)})`);
  return key;
}

/** Hold a newsletter's key, 0600 under a 0700 directory. */
export async function writeNewsletterKey(newsletter, key, options = {}) {
  if (typeof key !== "string" || !key.trim() || /\s/u.test(key.trim())) throw new TypeError("a Buttondown key is one nonempty token");
  const path = newsletterKeyPath(newsletter, options);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${key.trim()}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}
