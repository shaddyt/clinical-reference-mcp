/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { LRUCache } from 'lru-cache';

export interface CacheOptions {
  max: number;
  ttlMs: number;
}

// Thin typed wrapper over lru-cache. Values are cached as the generic V; the
// two module-level singletons hold `unknown` so callers parse with Zod at the
// boundary instead of trusting whatever was cached.
export class TtlCache<V extends NonNullable<unknown>> {
  private readonly inner: LRUCache<string, V>;

  constructor(opts: CacheOptions) {
    this.inner = new LRUCache<string, V>({
      max: opts.max,
      ttl: opts.ttlMs,
      // Inject Date as the clock so vitest's fake timers (which mock Date.now)
      // can deterministically advance TTL in tests. lru-cache captures
      // `performance` at module load, before vitest can intercept it.
      ttlResolution: 0,
      perf: { now: () => Date.now() },
    });
  }

  get(key: string): V | undefined {
    return this.inner.get(key);
  }

  set(key: string, value: V): void {
    this.inner.set(key, value);
  }

  has(key: string): boolean {
    return this.inner.has(key);
  }

  delete(key: string): boolean {
    return this.inner.delete(key);
  }

  clear(): void {
    this.inner.clear();
  }

  get size(): number {
    return this.inner.size;
  }
}

// 24h TTL chosen to match openFDA's daily-rebuild cadence: drug labels and
// adverse-event aggregates are rebuilt once a day, so a 24h cache returns
// data no staler than the upstream itself. 500 entries covers the long tail
// of distinct queries we expect from a single LLM session.
export const openFdaCache = new TtlCache<NonNullable<unknown>>({
  max: 500,
  ttlMs: 24 * 60 * 60 * 1000,
});

// 7d TTL because RxNorm concept identity (RxCUI ↔ name ↔ TTY ↔ class) is
// effectively static between the monthly RxNorm releases — a week-long cache
// avoids re-fetching identity that hasn't changed.
export const rxNormCache = new TtlCache<NonNullable<unknown>>({
  max: 1000,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
});
