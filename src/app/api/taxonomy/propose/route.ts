import { withAuth } from "@/server/auth";
import { proposeTaxonomy, taxonomyCatalog, confirmedNicheCount } from "@/server/ingest/taxonomy";
import { aiAvailable, getAIProvider } from "@/server/providers/ai";

export const POST = withAuth(async (req) => {
  const { niche, useAI } = (await req.json()) as { niche?: string; useAI?: boolean };
  if (!niche?.trim()) return Response.json({ error: "niche required" }, { status: 400 });
  if (niche.length > 120) return Response.json({ error: "niche too long (max 120 chars)" }, { status: 400 });
  const proposal = await proposeTaxonomy(niche);
  let aiCodes: string[] = [];
  if (useAI && (await aiAvailable()) && !proposal.autoApply) {
    const catalog = [...taxonomyCatalog().keys()];
    const ai = await getAIProvider();
    aiCodes = (await ai.proposeTaxonomy(niche, catalog)).filter((c) => !proposal.codes.includes(c));
  }
  const catalog = Object.fromEntries([...taxonomyCatalog().values()].map((e) => [e.code, e.label]));
  return Response.json({
    proposal,
    aiCodes,
    catalog,
    // HUMAN_CHECK #M: mapping confirmation is mandatory in-product for early/new niches
    confirmedNichesSoFar: await confirmedNicheCount(),
  });
});
