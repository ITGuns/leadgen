import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import fs from "node:fs";
import { and, desc, eq, sql } from "drizzle-orm";
import { freshDb } from "./helpers";
import { getDb } from "@/db/client";
import { auditLog, businesses, campaignLeads, exportsTable, leads, suppressions } from "@/db/schema";
import { registerAllHandlers } from "@/server/jobs/handlers";
import { Worker, enqueueJob } from "@/server/jobs/worker";
import { createCampaign, defaultFilters, startCampaign } from "@/server/campaigns";
import { createExport } from "@/server/exports/run";
import { DEFAULT_COLUMNS } from "@/server/exports/columns";
import { env } from "@/server/config";
import path from "node:path";

/** G7 — DB → XLSX → parse → identical rows; DNC never present. */

describe("G7 · export round-trip", () => {
  let campaignId: number;
  let dncLeadId: number;
  let notInterestedId: number;
  let dncLeadName: string;
  let notInterestedName: string;
  let suppressedPhone: string;
  const w = new Worker(1, 10);

  beforeAll(async () => {
    freshDb();
    registerAllHandlers();
    enqueueJob("ingest_overture", { states: ["TX"], chain: true }, { maxAttempts: 1 });
    await w.drain(120_000);
    const c = createCampaign(
      {
        name: "export test", niche: "roofers", confirmedTaxonomy: ["roofing_contractor", "roofing_service"],
        states: ["TX"], filters: defaultFilters(), caps: { maxRecords: 5000, budgetCapUSD: 0 },
        smoke: true, aiOwnerExtraction: false, topUp: null,
      },
      "t@gemfieldconsulting.com",
    );
    campaignId = c.id;
    startCampaign(campaignId, "t@gemfieldconsulting.com");
    await w.drain(180_000);

    // craft exclusions: one dnc status, one not_interested, one dnc-list suppression by phone
    const rows = getDb()
      .select({ lead: leads, business: businesses })
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .where(eq(campaignLeads.campaignId, campaignId))
      .all();
    expect(rows.length).toBeGreaterThan(10);
    const [a, b] = rows;
    const withPhone = rows.find((r) => r.business.phone && r.lead.id !== a.lead.id && r.lead.id !== b.lead.id)!;
    getDb().update(leads).set({ status: "dnc" }).where(eq(leads.id, a.lead.id)).run();
    getDb().update(leads).set({ status: "not_interested" }).where(eq(leads.id, b.lead.id)).run();
    getDb()
      .insert(suppressions)
      .values({ kind: "dnc", phone: withPhone.business.phone!, createdAt: new Date().toISOString(), source: "scrub" })
      .run();
    dncLeadId = a.lead.id;
    notInterestedId = b.lead.id;
    dncLeadName = a.business.name;
    notInterestedName = b.business.name;
    suppressedPhone = withPhone.business.phone!;
  }, 300_000);

  async function runExportJob(format: "xlsx" | "csv", includeExcluded = false): Promise<typeof exportsTable.$inferSelect> {
    const record = createExport(
      { campaignId, columns: DEFAULT_COLUMNS, includeExcluded },
      format,
      "t@gemfieldconsulting.com",
    );
    await w.drain(120_000);
    const done = getDb().select().from(exportsTable).where(eq(exportsTable.id, record.id)).get()!;
    expect(done.status).toBe("completed");
    expect(done.path && fs.existsSync(done.path)).toBeTruthy();
    return done;
  }

  it("XLSX round-trips identically and excludes DNC/not-interested/suppressed", async () => {
    const record = await runExportJob("xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(record.path!);
    const sheet = workbook.getWorksheet("Leads")!;
    expect(sheet).toBeTruthy();

    // expected rows: campaign leads minus excluded statuses minus dnc-list matches
    const expected = getDb()
      .select({ lead: leads, business: businesses })
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .where(and(eq(campaignLeads.campaignId, campaignId), sql`${leads.status} NOT IN ('dnc','not_interested')`))
      .all()
      .filter((r) => r.business.phone !== suppressedPhone)
      .sort((x, y) => (y.lead.score ?? -1) - (x.lead.score ?? -1) || x.lead.id - y.lead.id);

    expect(record.rowCount).toBe(expected.length);
    expect(sheet.rowCount).toBe(expected.length + 1); // + header

    const headers = (sheet.getRow(1).values as (string | undefined)[]).slice(1);
    expect(headers[0]).toBe("Score");
    const nameCol = headers.indexOf("Business") + 1;
    const scoreCol = headers.indexOf("Score") + 1;
    const phoneCol = headers.indexOf("Phone") + 1;
    const evidenceCol = headers.indexOf("Owner evidence") + 1;

    const exportedNames: string[] = [];
    const exportedPhones: string[] = [];
    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      const expectedRow = expected[i - 2];
      exportedNames.push(String(row.getCell(nameCol).value ?? ""));
      if (row.getCell(phoneCol).value != null) exportedPhones.push(String(row.getCell(phoneCol).value));
      expect(String(row.getCell(nameCol).value ?? "")).toBe(expectedRow.business.name);
      expect(Number(row.getCell(scoreCol).value)).toBe(expectedRow.lead.score);
      const phone = row.getCell(phoneCol).value;
      expect(phone == null ? null : String(phone)).toBe(expectedRow.business.phone);
      if (expectedRow.lead.ownerEvidence) {
        expect(String(row.getCell(evidenceCol).value ?? "")).toBe(expectedRow.lead.ownerEvidence);
      }
    }
    expect(exportedNames.length).toBeGreaterThan(0);
    expect(expected.some((r) => r.lead.id === dncLeadId || r.lead.id === notInterestedId)).toBe(false);
    expect(exportedPhones).not.toContain(suppressedPhone);

    // metadata sheet carries the attribution (license requirement — never remove)
    const meta = workbook.getWorksheet("About this export")!;
    let metaText = "";
    meta.eachRow((r) => (metaText += r.values?.toString() ?? ""));
    expect(metaText).toContain("Overture Maps Foundation");
    expect(metaText).toContain("Foursquare");
    expect(metaText).toContain("CC-BY-4.0");

    // audit trail: who, when, how many
    const auditRow = getDb().select().from(auditLog).orderBy(desc(auditLog.id)).all().find((a) => a.action === "export.completed");
    expect(auditRow).toBeTruthy();
    expect(auditRow!.actor).toBe("t@gemfieldconsulting.com");
    expect((auditRow!.detail as { rowCount: number }).rowCount).toBe(expected.length);
  }, 300_000);

  it("CSV exports the same universe", async () => {
    const record = await runExportJob("csv");
    const text = fs.readFileSync(record.path!, "utf8").trim();
    const lines = text.split("\r\n");
    expect(lines.length - 1).toBe(record.rowCount);
    expect(lines[0]).toContain("Score,Business");
    expect(text).not.toContain(suppressedPhone);
  }, 300_000);

  it("includeExcluded override brings statuses back (never the DNC list) and is audit-logged", async () => {
    const record = await runExportJob("xlsx", true);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(record.path!);
    const sheet = workbook.getWorksheet("Leads")!;
    const names: string[] = [];
    const phones: string[] = [];
    sheet.eachRow((row, n) => {
      if (n > 1) {
        names.push(String(row.getCell(2).value ?? ""));
        if (row.getCell(4).value != null) phones.push(String(row.getCell(4).value));
      }
    });
    expect(names).toContain(dncLeadName);
    expect(names).toContain(notInterestedName);
    expect(phones).not.toContain(suppressedPhone); // the DNC LIST never exports
    const override = getDb().select().from(auditLog).all().find((a) => a.action === "export.include_excluded_override");
    expect(override).toBeTruthy();
  }, 300_000);
});

describe("G7 · Drive push with per-campaign subfolder (mock, §3.5)", () => {
  it("creates the subfolder under drive-mock and links the uploaded file", async () => {
    // reuses the campaign from the suite above via a fresh export
    const record = createExport(
      { campaignId: 1, columns: DEFAULT_COLUMNS, includeExcluded: false, toDrive: true, driveSubfolder: "Roofers TX" },
      "xlsx",
      "t@gemfieldconsulting.com",
    );
    const w = new Worker(1, 10);
    await w.drain(120_000);
    const done = getDb().select().from(exportsTable).where(eq(exportsTable.id, record.id)).get()!;
    expect(done.status).toBe("completed");
    expect(done.driveLink).toBeTruthy();
    expect(done.driveLink).toContain(path.join("drive-mock", "Roofers TX"));
    const localCopy = done.driveLink!.replace("file://", "");
    expect(fs.existsSync(localCopy)).toBe(true);
    expect(localCopy.startsWith(path.join(env.exportsDir(), "drive-mock", "Roofers TX"))).toBe(true);
  }, 200_000);
});
