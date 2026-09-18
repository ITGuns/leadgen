import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, campaigns, exportsTable, leads, type ExportParams } from "@/db/schema";
import { audit } from "../audit";
import { env, now } from "../config";
import { isSuppressed, loadSuppressionSets } from "../suppression";
import { getDrive, driveAvailable } from "../providers/drive";
import { driveFolderId } from "../providers/drive/oauth";
import { JobStopped, type JobContext } from "../jobs/registry";
import { enqueueJob } from "../jobs/worker";
import { pickColumns, type ExportRow } from "./columns";
import { storageConfigured, uploadExport } from "./storage";

/**
 * §3.5/§3.6 — exports run as background jobs with a streaming writer; a 50k-row export
 * must not block a request or spike memory. Exclusions:
 *  · DNC-list-suppressed rows NEVER export, full stop (badge in UI explains).
 *  · status ∈ {dnc, not_interested} and client-list rows are excluded BY DEFAULT;
 *    includeExcluded overrides those two and is audit-logged.
 */

const BATCH = 500;

function exportConditions(params: ExportParams): SQL {
  const parts: SQL[] = [sql`1=1`];
  if (params.leadIds?.length) parts.push(inArray(leads.id, params.leadIds.slice(0, 100_000)));
  if (params.campaignId) {
    parts.push(
      sql`EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.lead_id = ${leads.id} AND cl.campaign_id = ${params.campaignId})`,
    );
  }
  const f = (params.filters ?? {}) as { status?: string[]; minScore?: number; states?: string[] };
  if (f.status?.length) parts.push(sql`${leads.status} IN (${sql.join(f.status.map((s) => sql`${s}`), sql`, `)})`);
  if (f.minScore != null) parts.push(sql`coalesce(${leads.score}, -1) >= ${f.minScore}`);
  if (f.states?.length) parts.push(sql`${businesses.region} IN (${sql.join(f.states.map((s) => sql`${s}`), sql`, `)})`);
  if (!params.includeExcluded) parts.push(sql`${leads.status} NOT IN ('dnc', 'not_interested')`);
  return and(...parts)!;
}

async function* exportRows(params: ExportParams): AsyncGenerator<ExportRow> {
  const db = getDb();
  const dnc = await loadSuppressionSets("dnc");
  const client = await loadSuppressionSets("client");
  const cond = exportConditions(params);
  for (let offset = 0; ; offset += BATCH) {
    const batch = await db
      .select({ lead: leads, business: businesses })
      .from(leads)
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .where(cond)
      .orderBy(sql`coalesce(${leads.score}, -1) DESC`, asc(leads.id))
      .limit(BATCH)
      .offset(offset);
    if (!batch.length) return;
    for (const row of batch) {
      if (isSuppressed(row.business, dnc)) continue; // never exports
      if (!params.includeExcluded && isSuppressed(row.business, client)) continue;
      yield row;
    }
  }
}

async function exportFilename(exportId: number, format: string, params: ExportParams): Promise<string> {
  const db = getDb();
  let niche = "leads";
  let states = "all";
  if (params.campaignId) {
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, params.campaignId)).limit(1);
    if (c) {
      niche = c.niche.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      states = c.states.join("-");
    }
  }
  const date = now().toISOString().slice(0, 10);
  return `leadforge_${niche}_${states}_${date}_${exportId}.${format}`;
}

const ATTRIBUTION_LINES = [
  "Business listings © Overture Maps Foundation and contributors — CDLA-Permissive-2.0 / Apache-2.0 (overturemaps.org)",
  "Gap-fill data © Foursquare OS Places — Apache-2.0",
  "City data © SimpleMaps US Cities (basic) — CC-BY-4.0 (simplemaps.com/data/us-cities)",
];

export async function runExport(ctx: JobContext): Promise<void> {
  const db = getDb();
  const exportId = (ctx.job.payload as { exportId?: number } | null)?.exportId;
  if (!exportId) throw new Error("export job: no exportId");
  const [record] = await db.select().from(exportsTable).where(eq(exportsTable.id, exportId)).limit(1);
  if (!record || record.status === "completed") return;
  await db.update(exportsTable).set({ status: "running" }).where(eq(exportsTable.id, exportId));

  try {
    const params = record.params;
    const filename = await exportFilename(exportId, record.format, params);
    const outPath = path.join(env.exportsDir(), filename);
    fs.mkdirSync(env.exportsDir(), { recursive: true });
    const columns = pickColumns(params.columns ?? []);
    const mime =
      record.format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv";
    let rowCount = 0;

    if (record.format === "xlsx") {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: outPath, useStyles: true });
      const sheet = workbook.addWorksheet("Leads", { views: [{ state: "frozen", ySplit: 1 }] });
      sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18181B" } };
      sheet.getRow(1).commit();
      for await (const row of exportRows(params)) {
        if (ctx.shouldStop()) throw new JobStopped(); // slice deadline — restart-safe (file rewritten)
        const values = columns.map((c) => c.value(row));
        const added = sheet.addRow(values);
        columns.forEach((c, i) => {
          const cell = added.getCell(i + 1);
          const link = c.hyperlink?.(row);
          if (link) cell.value = { text: String(c.value(row) ?? ""), hyperlink: link };
          if (c.key === "score" && typeof row.lead.score === "number") {
            const argb = row.lead.score >= 85 ? "FF7F1D1D" : row.lead.score >= 60 ? "FF92400E" : row.lead.score >= 40 ? "FF854D0E" : "FF14532D";
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
            cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
          }
        });
        added.commit();
        rowCount++;
        if (rowCount % 1000 === 0) await ctx.checkpoint({ rowCount });
      }
      const meta = workbook.addWorksheet("About this export");
      const [c] = params.campaignId
        ? await db.select().from(campaigns).where(eq(campaigns.id, params.campaignId)).limit(1)
        : [null];
      const metaRows: [string, string][] = [
        ["Generated by", `LeadForge (internal) · ${record.requestedBy}`],
        ["Generated at", now().toISOString()],
        ["Rows", String(rowCount)],
        ["Campaign", c ? `#${c.id} ${c.name} (${c.niche} · ${c.states.join(", ")})` : "—"],
        ["Data releases", c ? `Overture ${c.releaseOverture ?? "?"} · FSQ ${c.releaseFsq ?? "?"}` : "per-lead sources column"],
        ["Exclusions", params.includeExcluded ? "NONE (override was audit-logged)" : "DNC + not-interested statuses, DNC-list and client-list matches"],
        ["", ""],
        ...ATTRIBUTION_LINES.map((l) => ["Attribution", l] as [string, string]),
        ["", ""],
        ["Email compliance", "CAN-SPAM: identify the sender, include a physical postal address, honor unsubscribes. LeadForge stores and exports; it never sends."],
      ];
      for (const [k, v] of metaRows) meta.addRow([k, v]).commit();
      meta.getColumn(1).width = 18;
      meta.getColumn(2).width = 110;
      await workbook.commit();
    } else {
      // CSV for CRM imports
      const out = fs.createWriteStream(outPath, "utf8");
      const esc = (v: string | number | null): string => {
        if (v == null) return "";
        const s = String(v);
        return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
      };
      out.write(columns.map((c) => esc(c.header)).join(",") + "\r\n");
      for await (const row of exportRows(params)) {
        if (ctx.shouldStop()) throw new JobStopped();
        out.write(columns.map((c) => esc(c.value(row))).join(",") + "\r\n");
        rowCount++;
        if (rowCount % 1000 === 0) await ctx.checkpoint({ rowCount });
      }
      await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
    }

    let driveLink: string | null = null;
    if ((params.toDrive || params.driveSubfolder !== undefined) && (await driveAvailable())) {
      const drive = await getDrive();
      let folderId = await driveFolderId();
      const sub = (params.driveSubfolder ?? "").trim();
      if (sub) folderId = (await drive.ensureFolder(sub, folderId)).id; // §3.5 per-campaign subfolder
      const uploaded = await drive.upload(outPath, filename, folderId, mime);
      driveLink = uploaded.webViewLink;
    }

    // D19 — durable artifact store: Supabase Storage when configured (Vercel's /tmp is
    // per-invocation), local exports dir otherwise. The download route resolves both.
    let storedPath = outPath;
    if (storageConfigured()) {
      storedPath = await uploadExport(outPath, filename, mime);
      fs.rmSync(outPath, { force: true });
    }

    await db
      .update(exportsTable)
      .set({ status: "completed", path: storedPath, rowCount, driveLink, finishedAt: now().toISOString() })
      .where(eq(exportsTable.id, exportId));
    await audit(record.requestedBy, "export.completed", {
      exportId, format: record.format, rowCount,
      includeExcluded: params.includeExcluded, campaignId: params.campaignId ?? null, drive: !!driveLink,
    });
  } catch (err) {
    await db
      .update(exportsTable)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err), finishedAt: now().toISOString() })
      .where(eq(exportsTable.id, exportId));
    throw err;
  }
}

export async function createExport(
  params: ExportParams,
  format: "xlsx" | "csv",
  requestedBy: string,
): Promise<typeof exportsTable.$inferSelect> {
  const db = getDb();
  const [record] = await db
    .insert(exportsTable)
    .values({ format, params, requestedBy, createdAt: now().toISOString() })
    .returning();
  if (params.includeExcluded) {
    await audit(requestedBy, "export.include_excluded_override", { exportId: record.id });
  }
  await enqueueJob("export", { exportId: record.id }, { campaignId: params.campaignId });
  return record;
}
