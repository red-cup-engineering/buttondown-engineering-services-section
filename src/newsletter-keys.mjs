import { readFile } from "node:fs/promises";
import { credentialPath, keepCredential } from "@red-cup-engineering/credential-custody-service/keep";

/**
 * One API key per Buttondown newsletter, a credential of the host's store. A newsletter's routing name (a persona's
 * `buttondown` presence, a serial manifest's `buttondownNewsletter`) resolves to `buttondown/<newsletter>.api-key`
 * in this process's credentials directory (CREDENTIALS_DIRECTORY), holding the key and nothing else. A key a person
 * pastes is kept in the store (keepCredential); it never enters git, a record or a process-wide environment variable.
 */

export const NEWSLETTER_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

function newsletterName(newsletter) {
  if (typeof newsletter !== "string" || !NEWSLETTER_NAME.test(newsletter)) throw new TypeError(`a Buttondown newsletter is named by a stable lowercase routing name, not ${JSON.stringify(newsletter)}`);
  return newsletter;
}

/** Where a newsletter's key is read. */
export function newsletterKeyPath(newsletter, { env = process.env } = {}) {
  return credentialPath(`buttondown/${newsletterName(newsletter)}.api-key`, env);
}

/** The newsletter's key, or null when none is held yet (or this process was given no credentials). */
export async function readNewsletterKey(newsletter, options = {}) {
  if (!(options.env ?? process.env).CREDENTIALS_DIRECTORY) return null;
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

/** Keep a newsletter's key in the host's credential store; returns where it is now read. */
export async function writeNewsletterKey(newsletter, key, { env = process.env } = {}) {
  if (typeof key !== "string" || !key.trim() || /\s/u.test(key.trim())) throw new TypeError("a Buttondown key is one nonempty token");
  const name = newsletterName(newsletter);
  return (await keepCredential({ id: `buttondown.${name}`, service: "buttondown", path: `buttondown/${name}.api-key`, value: `${key.trim()}\n`, kind: "api-key", provider: "buttondown" }, env)).path;
}
