/**
 * ARCH A4 — the single global scheduler. Two concurrently-running campaigns share
 * provider limits fairly: work units are admitted round-robin BY CAMPAIGN, not FIFO,
 * so one big campaign can't starve a smoke run. The PageSpeed daily quota check lives
 * with its provider (providers/pagespeed); this gate owns concurrency + fairness.
 */

type Waiter = { resolve: (release: () => void) => void };

export class RoundRobinGate {
  private queues = new Map<string, Waiter[]>();
  private order: string[] = [];
  private cursor = 0;
  private active = 0;

  constructor(private concurrency: number) {}

  acquire(key: string): Promise<() => void> {
    return new Promise((resolve) => {
      if (!this.queues.has(key)) {
        this.queues.set(key, []);
        this.order.push(key);
      }
      this.queues.get(key)!.push({ resolve });
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.active < this.concurrency) {
      const next = this.nextWaiter();
      if (!next) return;
      this.active++;
      let released = false;
      next.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        this.dispatch();
      });
    }
  }

  private nextWaiter(): Waiter | null {
    const n = this.order.length;
    for (let i = 0; i < n; i++) {
      const key = this.order[(this.cursor + i) % n];
      const q = this.queues.get(key);
      if (q && q.length) {
        this.cursor = (this.cursor + i + 1) % n; // advance past the served campaign
        return q.shift()!;
      }
    }
    // clean up drained keys occasionally
    if (this.order.length > 64) {
      this.order = this.order.filter((k) => (this.queues.get(k)?.length ?? 0) > 0);
      this.queues.forEach((q, k) => q.length === 0 && this.queues.delete(k));
      this.cursor = 0;
    }
    return null;
  }
}

type G = typeof globalThis & { __leadforgeGates?: { fetch: RoundRobinGate; pagespeed: RoundRobinGate; ai: RoundRobinGate } };
const g = globalThis as G;

export function gates() {
  if (!g.__leadforgeGates) {
    g.__leadforgeGates = {
      fetch: new RoundRobinGate(8), // fetcher's own per-domain/global caps still apply underneath
      pagespeed: new RoundRobinGate(3),
      ai: new RoundRobinGate(2),
    };
  }
  return g.__leadforgeGates;
}
