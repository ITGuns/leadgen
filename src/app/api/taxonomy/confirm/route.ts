import { withAuth } from "@/server/auth";
import { audit } from "@/server/audit";
import { confirmTaxonomy, taxonomyCatalog } from "@/server/ingest/taxonomy";

export const POST = withAuth(async (req, identity) => {
  const { niche, codes } = (await req.json()) as { niche?: string; codes?: string[] };
  if (!niche?.trim() || !codes?.length) return Response.json({ error: "niche and codes required" }, { status: 400 });
  if (niche.length > 120 || codes.length > 12) return Response.json({ error: "niche max 120 chars, max 12 codes" }, { status: 400 });
  const catalog = taxonomyCatalog();
  const bad = codes.filter((c) => !catalog.has(c));
  if (bad.length) return Response.json({ error: `unknown codes: ${bad.join(", ")}` }, { status: 400 });
  await confirmTaxonomy(niche, codes, identity.email);
  await audit(identity.email, "taxonomy.confirm", { niche, codes });
  return Response.json({ ok: true });
});
