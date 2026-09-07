import type { jobs } from "@/db/schema";

export type JobRow = typeof jobs.$inferSelect;

export type JobContext = {
  job: JobRow;
  /** Persist a resumable checkpoint (merged into job.progress). */
  checkpoint(progress: Record<string, unknown>): Promise<void>;
  /** True when the job was canceled, the worker is shutting down, or a serverless
   * slice's time budget is exhausted — exit cleanly ASAP (checkpoint + JobStopped). */
  shouldStop(): boolean;
  /** Absolute epoch-ms deadline for this slice (Infinity in persistent mode). */
  deadline: number;
};

export class JobStopped extends Error {
  constructor() {
    super("job stopped");
    this.name = "JobStopped";
  }
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerHandler(type: string, fn: JobHandler): void {
  handlers.set(type, fn);
}
export function getHandler(type: string): JobHandler | undefined {
  return handlers.get(type);
}
export function registeredTypes(): string[] {
  return [...handlers.keys()];
}
