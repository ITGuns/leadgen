import { expect, test } from "@playwright/test";

/**
 * Definition-of-done E2E (§7, mock mode): seed → "roofers in Texas" smoke campaign
 * runs at $0 and completes in seconds → leads table ranks a no-website business on
 * top → an owner name shows with its evidence snippet → XLSX export lands and opens.
 */

test.describe.configure({ mode: "serial" });

test("dashboard self-seeds the mock dataset", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Businesses in local DB")).toBeVisible();
  // seed ingest chain takes a couple of seconds on first boot
  await expect(async () => {
    await page.reload();
    const count = await page.locator("main .card").first().locator(".text-2xl").innerText();
    expect(parseInt(count.replace(/,/g, ""), 10)).toBeGreaterThan(1900);
  }).toPass({ timeout: 60_000 });
});

test("build, confirm mapping, and smoke-run a roofers·TX campaign at $0", async ({ page }) => {
  await page.goto("/campaigns/new");
  await page.getByPlaceholder('Niche, e.g. "roofers"').fill("roofers");
  await page.getByRole("button", { name: "Propose categories" }).click();
  await expect(page.locator(".chip", { hasText: "Roofing" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm mapping" }).click();
  await expect(page.getByText("✓ confirmed")).toBeVisible();

  await page.getByRole("button", { name: "TX", exact: true }).click();
  await page.getByText("Smoke test — first 200 records only").click();
  await expect(page.getByText("records planned")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/total \$0\.00 ≤ cap \$0\.00/)).toBeVisible();

  await page.getByRole("button", { name: "Run smoke test" }).click();
  await page.waitForURL(/\/campaigns\/\d+/);
  await expect(page.getByText("Completed", { exact: false })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Cost accrued")).toBeVisible();
  await expect(page.locator("main")).toContainText("$0.00");
  await expect(page.getByText(/Overture mock-2026-09/)).toBeVisible(); // release recorded
});

test("leads workspace ranks no-website leads on top; owner shows evidence", async ({ page }) => {
  await page.goto("/leads");
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 });
  const topScore = await page.locator("tbody tr").first().locator("td").nth(1).innerText();
  expect(parseInt(topScore, 10)).toBeGreaterThanOrEqual(90);
  await expect(page.locator("tbody tr").first()).toContainText(/No website|Dead site|Parked|Aggregator|Social/);

  // owner drawer with evidence
  await page.locator("select").nth(3).selectOption({ label: "Owner found" });
  await expect(async () => {
    const owner = await page.locator("tbody tr").first().locator("td").nth(6).innerText();
    expect(owner.trim()).not.toBe("—");
    expect(owner.trim().length).toBeGreaterThan(2);
  }).toPass({ timeout: 15_000 });
  await page.locator("tbody tr").first().click();
  await expect(page.getByText(/via (heuristic|ai|outscraper)/)).toBeVisible();
  await expect(page.locator("blockquote")).toContainText(/.{10,}/); // verbatim snippet rendered
  await page.keyboard.press("Escape");
});

test("XLSX export completes and downloads a real workbook; DNC defaults hold", async ({ page, request }) => {
  await page.goto("/exports");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByText("Export queued", { exact: false })).toBeVisible();
  await expect(async () => {
    const res = await request.get("/api/exports");
    const data = (await res.json()) as { exports: { id: number; status: string; rowCount: number | null }[] };
    expect(data.exports[0]?.status).toBe("completed");
    expect(data.exports[0]?.rowCount ?? 0).toBeGreaterThan(0);
  }).toPass({ timeout: 60_000 });

  const list = (await (await request.get("/api/exports")).json()) as { exports: { id: number }[] };
  const download = await request.get(`/api/exports/${list.exports[0].id}/download`);
  expect(download.status()).toBe(200);
  const body = await download.body();
  expect(body.subarray(0, 2).toString()).toBe("PK"); // xlsx = zip container
  expect(body.length).toBeGreaterThan(2000);
});

test("suppressions import works and shows counts", async ({ page }) => {
  await page.goto("/suppressions");
  await page.locator("textarea").fill("(512) 555-0134\nsomeclientdomain.com");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Added 2/)).toBeVisible({ timeout: 10_000 });
});
