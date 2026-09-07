// Re-apply community labels to the exported artifacts. The bundled CLI's label
// ingest (v-current) drops assistant-mode names, so run this AFTER any
// `graphify label/describe/cite/studio export` regeneration:  node .graphify/stamp-labels.js
const fs = require("fs");
const labels = JSON.parse(fs.readFileSync(".graphify/labels-canonical.json", "utf-8"));
const name = (cid) => labels[String(cid)] || "Community " + cid;
for (const f of [".graphify/graph.json", ".graphify/studio/graph.json"]) {
  if (!fs.existsSync(f)) continue;
  const g = JSON.parse(fs.readFileSync(f, "utf-8"));
  for (const n of g.nodes) n.community_name = name(n.community);
  fs.writeFileSync(f, JSON.stringify(g));
  console.log("stamped " + f);
}
const sf = ".graphify/studio/scene.json";
if (fs.existsSync(sf)) {
  const s = JSON.parse(fs.readFileSync(sf, "utf-8"));
  for (const n of s.nodes) { n.group = name(n.community); if (n.community_name) n.community_name = name(n.community); }
  if (s.communityColors && !Array.isArray(s.communityColors)) {
    const remapped = {};
    for (const [k, v] of Object.entries(s.communityColors)) {
      const m = k.match(/^Community (\d+)$/);
      remapped[m ? name(m[1]) : k] = v;
    }
    s.communityColors = remapped;
  }
  fs.writeFileSync(sf, JSON.stringify(s));
  console.log("stamped " + sf);
}
