import { keyNewsletter } from "./buttondown.mjs";
import { readNewsletterKey, writeNewsletterKey } from "./newsletter-keys.mjs";

/**
 * The driver for obligation records of kind `buttondown-api-key` (see the operations console's declared
 * obligations): a person made a Buttondown account for a newsletter and pastes its API key. The node
 * checks the key reaches that newsletter and only then holds it where persona-provision and the
 * publishing scripts read it (newsletter-keys.mjs); the key is never shown again or written anywhere else.
 *
 * The original typed handoff supplies `expectedOutcome.newsletterHandle`. That source field is a routing claim, not a credential. The verified key is kept by newsletter-keys.
 * @param {{ env?: NodeJS.ProcessEnv, fetch?: typeof fetch }} [options]
 */
export function buttondownKeyDriver({ env = process.env, fetch: fetchImpl = fetch } = {}) {
  const where = { env };
  return {
    kind: "buttondown-api-key",
    instances: (record) => [{ id: record.handoffId, vars: { newsletter: record.expectedOutcome.newsletterHandle } }],
    async held(record) { return (await readNewsletterKey(record.expectedOutcome.newsletterHandle, where)) !== null; },
    prepare: () => ({}),
    async capture(record, instance, memo, answer) {
      const newsletter = record.expectedOutcome.newsletterHandle;
      const key = String(answer).trim();
      if (!/^[A-Za-z0-9_-]{20,}$/u.test(key)) throw new Error("That does not look like a Buttondown API key (one long token, letters and digits). Copy it again from Settings, API.");
      let held;
      try { held = await keyNewsletter({ token: key, fetch: fetchImpl }); }
      catch (error) { throw new Error(`Buttondown did not accept that key: ${error.message}`); }
      if (held.username.toLowerCase() !== newsletter.toLowerCase()) throw new Error(`That key belongs to the newsletter ${held.username}, not ${newsletter}. Make the key inside the ${newsletter} newsletter.`);
      return { custody: await writeNewsletterKey(newsletter, key, where) };
    },
  };
}
