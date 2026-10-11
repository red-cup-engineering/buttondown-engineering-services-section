import { subscriberCounts } from "../src/buttondown.mjs";
import { newsletterKey } from "../src/newsletter-keys.mjs";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

/**
 * Print one newsletter's subscriber counts by type, for each `{"newsletter": name}`
 * line on standard input. The newsletter's key is read from its key file
 * (newsletter-keys.mjs); counts carry no addresses.
 *
 * @param {string} newsletter - the newsletter's routing name
 * @returns {Promise<{newsletter: string, total: number, byType: Record<string, number>}>}
 * @throws {Error} if no key is held for the newsletter
 */
export async function listButtondownSubscriberCounts(newsletter) {
  if (!newsletter) throw new Error("name the newsletter: {\"newsletter\": \"<name>\"}");
  return { newsletter, ...(await subscriberCounts({ token: await newsletterKey(newsletter), fetch })) };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "list-buttondown-subscribers", description: "Print a newsletter's subscriber counts by type, for each {\"newsletter\": name} line on standard input.", inputSchema: { type: "object", required: ["newsletter"], properties: { newsletter: { type: "string" } } }, operation: ({ newsletter }) => listButtondownSubscriberCounts(newsletter) }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
