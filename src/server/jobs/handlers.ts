import { registerHandler } from "./registry";
import { runOvertureExtract } from "../ingest/overture";
import { runFsqExtract } from "../ingest/fsq";
import { runConflate } from "../ingest/conflate";
import { runCampaign } from "../pipeline/run";
import { runExport } from "../exports/run";
import { runBackup } from "./backup";
import { runFreshness } from "./freshness";

/** Central handler registration. Import `registerAllHandlers()` once at boot (instrumentation)
 *  and in tests/e2e before running the worker. Extended as phases land. */

let registered = false;
export function registerAllHandlers(): void {
  if (registered) return;
  registered = true;
  registerHandler("ingest_overture", runOvertureExtract);
  registerHandler("ingest_fsq", runFsqExtract);
  registerHandler("conflate", runConflate);
  registerHandler("campaign_run", runCampaign);
  registerHandler("export", runExport);
  registerHandler("backup", runBackup);
  registerHandler("freshness", runFreshness);
}
