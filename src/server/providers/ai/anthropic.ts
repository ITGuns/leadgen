import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config";
import type { AIProvider, OwnerExtraction } from "../types";
import { OwnerExtractionSchema } from "../types";

/**
 * §1/§3.3 — Haiku 4.5 behind the AIProvider adapter (the guide pins ANTHROPIC_MODEL,
 * default claude-haiku-4-5; ~$0.001/site). Outputs are zod-validated; the no-snippet-
 * no-name rule is enforced by schema AND by verifying the snippet appears in the pages.
 */

const OWNER_SYSTEM = `You extract the owner of a small business from that business's own website text.

Rules — follow them exactly:
- Accept a person ONLY if the text ties them to THIS business as its owner, founder, proprietor, principal, co-owner, or owner-operator.
- NEVER extract: names from customer reviews or testimonials, franchise or corporate executives (CEO/president of a parent brand), web designer or agency credits ("site by ..."), team rosters without an ownership role, or names you are not sure about.
- evidenceSnippet MUST be a verbatim quote (≤ 240 chars) copied from the provided text that contains the name and the ownership language. No quote = do not return a name.
- If the site clearly represents a multi-location or franchise operation, set confidence to "low".
- If no owner is identifiable, return {"found": false}.

Respond with ONLY a JSON object, no prose:
{"found": true, "ownerName": "...", "role": "...", "evidenceSnippet": "...", "confidence": "high"|"low"}
or {"found": false}`;

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly costPerOwnerCallUSD = 0.001;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extractOwner(input: {
    businessName: string;
    multiLocation: boolean;
    pages: { url: string; text: string }[];
  }): Promise<{ extraction: OwnerExtraction | null; costUSD: number }> {
    const pagesText = input.pages
      .map((p) => `--- PAGE ${p.url} ---\n${p.text.slice(0, 6000)}`)
      .join("\n\n")
      .slice(0, 16000);
    let raw: string;
    let costUSD = this.costPerOwnerCallUSD;
    try {
      const response = await this.client.messages.create({
        model: env.anthropicModel(),
        max_tokens: 500,
        system: OWNER_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Business: "${input.businessName}"${input.multiLocation ? " (known multi-location)" : ""}\n\n${pagesText}`,
          },
        ],
      });
      // actual spend from reported usage at Haiku 4.5 rates ($1/$5 per MTok)
      costUSD = response.usage.input_tokens * 1e-6 + response.usage.output_tokens * 5e-6;
      const block = response.content.find((b) => b.type === "text");
      raw = block && block.type === "text" ? block.text : "";
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(`anthropic owner extraction failed (${error.status}): ${error.message}`);
      }
      throw error;
    }
    const none = { extraction: null, costUSD };
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return none;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return none;
    }
    const obj = parsed as { found?: boolean };
    if (!obj.found) return none;
    const validated = OwnerExtractionSchema.safeParse(parsed);
    if (!validated.success || !validated.data.ownerName) return none;
    // anti-hallucination: the snippet must actually appear in the fetched pages
    const allText = input.pages.map((p) => p.text).join("\n");
    const snippet = validated.data.evidenceSnippet.trim();
    if (!allText.includes(snippet.slice(0, Math.min(snippet.length, 80)))) return none;
    const confidence = input.multiLocation ? "low" : validated.data.confidence;
    return { extraction: { ...validated.data, confidence }, costUSD };
  }

  async proposeTaxonomy(niche: string, catalog: string[]): Promise<string[]> {
    try {
      const response = await this.client.messages.create({
        model: env.anthropicModel(),
        max_tokens: 300,
        system:
          'Map a business niche phrase to matching category codes from the provided catalog. Respond ONLY with a JSON array of 1-5 codes from the catalog, best matches first. Codes not in the catalog are forbidden.',
        messages: [{ role: "user", content: `Niche: "${niche}"\n\nCatalog:\n${catalog.join("\n")}` }],
      });
      const block = response.content.find((b) => b.type === "text");
      const raw = block && block.type === "text" ? block.text : "[]";
      const match = raw.match(/\[[\s\S]*\]/);
      const arr = match ? (JSON.parse(match[0]) as string[]) : [];
      const catalogSet = new Set(catalog);
      return arr.filter((c) => catalogSet.has(c)).slice(0, 5);
    } catch {
      return []; // taxonomy assist is best-effort; curated/fuzzy paths still work
    }
  }
}
