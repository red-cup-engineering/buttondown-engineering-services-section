import { alignNewsletterProfile, keyNewsletter } from "./buttondown.mjs";
import { readNewsletterKey, writeNewsletterKey } from "./newsletter-keys.mjs";

/**
 * Make a newsletter so: the Buttondown account exists under its routing name, its key is held
 * (newsletter-keys.mjs), and its name, description, sender and reply-to match the profile given.
 *
 * Making the account and its key are the steps only a person can do (Buttondown's sign-up has a challenge and
 * mails a confirmation); `person.ask` shows them in the assisted browser and takes the key. Everything after is
 * the API. Without a person the result says which step waits.
 *
 * @param {object} input
 * @param {string} input.newsletter - the routing name, which is also the Buttondown username
 * @param {string} input.email - the address the account is made with
 * @param {{name: string, description?: string, from_name?: string, reply_to_address?: string}} input.profile
 * @param {object|null} [input.person] - the person at the node (assisted-browser person), or null
 * @param {typeof fetch} input.fetch
 * @param {boolean} [input.dryRun]
 * @param {{read: Function, write: Function}} [input.keys] - where keys are held; the key files by default
 * @returns {Promise<{platform: "buttondown", newsletter: string, url: string, state: string, step?: string, changed?: string[]}>}
 */
export async function provisionNewsletter({ newsletter, email, profile, person = null, fetch: fetchImpl, dryRun = false, keys = { read: readNewsletterKey, write: writeNewsletterKey } } = {}) {
  const row = { platform: "buttondown", newsletter, url: `https://buttondown.com/${newsletter}` };
  let token = await keys.read(newsletter);
  let created = false;
  if (!token) {
    if (dryRun) return { ...row, state: "would-create" };
    if (!person) return { ...row, state: "waits-on-person", step: "account" };
    token = await person.ask({
      at: "https://buttondown.com/register",
      text: [
        `Make the Buttondown newsletter for ${profile.name}:`,
        `1. Sign up with the username ${newsletter} and the address ${email}, and confirm the email Buttondown sends there.`,
        "2. Keep the free plan; skip the import and the paid-subscription steps.",
        "3. Open Settings → API (buttondown.com/settings/api), create a key, and paste it here.",
      ].join("\n"),
      values: [{ label: "Username", value: newsletter }, { label: "Address", value: email }],
      input: { label: "The API key", pattern: /^[A-Za-z0-9_-]{20,}$/u },
    });
    await keys.write(newsletter, token.trim());
    created = true;
  }
  const held = await keyNewsletter({ token: token.trim(), fetch: fetchImpl });
  if (held.username.toLowerCase() !== newsletter.toLowerCase()) throw new Error(`the key held for ${newsletter} belongs to the newsletter ${held.username}`);
  const changed = dryRun ? [] : await alignNewsletterProfile({ token: token.trim(), fetch: fetchImpl, newsletter: held, profile });
  return { ...row, url: `https://buttondown.com/${held.username}`, state: created ? "created" : "held", changed };
}
