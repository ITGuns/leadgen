import { getDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { now } from "./config";

export function audit(actor: string, action: string, detail?: Record<string, unknown>): void {
  getDb()
    .insert(auditLog)
    .values({ actor, action, detail: detail ?? null, createdAt: now().toISOString() })
    .run();
}
