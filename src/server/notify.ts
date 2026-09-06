import { effectiveSecret } from "./secure-store";

/**
 * Ops alerting: POST a Slack-compatible `{text}` payload to the configured webhook
 * (Settings → keys → alert_webhook_url; works with Slack/Discord/Google Chat-style
 * receivers) whenever a job exhausts its retries. Fire-and-forget — alerting must
 * never break or slow the worker, and silence (no URL) is a valid configuration.
 */
export async function notifyFailure(subject: string, detail: string): Promise<void> {
  const url = effectiveSecret("alert_webhook_url", "");
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `⚠️ LeadForge: ${subject}\n${detail}`.slice(0, 3000) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // never let alerting failures cascade
  }
}
