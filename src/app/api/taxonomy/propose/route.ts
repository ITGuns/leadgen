import { withAuth } from "@/server/auth";
import { proposeTaxonomy, taxonomyCatalog, confirmedNicheCount } from "@/server/ingest/taxonomy";
import { aiAvailable, getAIProvider } from "@/server/providers/ai";

export const POST = withAuth(async (req) => {
  const { niche, useAI } = (await req.json()) as { niche?: string; useAI?: boolean };
  if (!niche?.trim()) return Response.json({ error: "niche required" }, { status: 400 });
  const proposal = proposeTaxonomy(niche);
  let aiCodes: string[] = [];
  if (useAI && aiAvailable() && !proposal.autoApply) {
    const catalog = [...taxonomyCatalog().keys()];
    aiCodes = (await getAIProvider().proposeTaxonomy(niche, catalog)).filter((c) => !proposal.codes.includes(c));
  }
  const catalog = Object.fromEntries([...taxonomyCatalog().values()].map((e) => [e.code, e.label]));
  return Response.json({
    proposal,
    aiCodes,
    catalog,
    // HUMAN_CHECK #M: mapping confirmation is mandatory in-product for early/new niches
    confirmedNichesSoFar: confirmedNicheCount(),
  });
});
