/**
 * Lightweight, dependency-free instrumentation for the extraction pipeline.
 *
 * Two primitives:
 *   - `Stopwatch` / `time()` — measure wall-clock per stage and per sub-step,
 *     so the log shows where the 6-minute extraction actually goes instead of
 *     us inferring it from the gaps between start-of-stage log lines.
 *   - a process-global `GetLine` counter — the dominant cost in a web-ifc walk
 *     is the number of WASM↔JS line crossings, so counting them turns "the
 *     walk is slow" into "the walk made N GetLine calls".
 *
 * Concurrency note: the counter is a single module-global, but it is only ever
 * read as a *delta* around a synchronous span (the metadata/properties walks
 * have no `await` inside their loops). JS is single-threaded, so no other job's
 * GetLine calls can interleave within that synchronous span even when
 * JOB_CONCURRENCY > 1 — the delta is therefore attributable to that one walk.
 */

import { performance } from 'node:perf_hooks';

/** Accumulates elapsed time under named marks. Call `mark(label)` at the end of
 * each step; the time since the previous mark (or construction) is added under
 * that label. `timings()` returns whole-millisecond totals for logging. */
export class Stopwatch {
  private readonly marks = new Map<string, number>();
  private last = performance.now();

  mark(label: string): void {
    const now = performance.now();
    this.marks.set(label, (this.marks.get(label) ?? 0) + (now - this.last));
    this.last = now;
  }

  timings(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [label, ms] of this.marks) out[label] = Math.round(ms);
    return out;
  }
}

/** Run `fn`, returning its result alongside the rounded milliseconds it took. */
export async function time<T>(
  fn: () => Promise<T> | T,
): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

// ── GetLine crossing counter ───────────────────────────────────────────────

let getLineCalls = 0;

/** Incremented once per web-ifc `GetLine` call (see the wrapper in ifc.ts). */
export function bumpGetLine(): void {
  getLineCalls += 1;
}

/** Current cumulative GetLine count. Read before and after a synchronous span
 * and subtract to get that span's crossings. */
export function readGetLine(): number {
  return getLineCalls;
}
