/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

export interface RateLimiterOptions {
  tokensPerInterval: number;
  intervalMs: number;
  maxBurst?: number;
}

// Lazy-refill token bucket: rather than running a refill timer, we recompute
// the available token count on demand from elapsed wall-clock time. This
// keeps the limiter zero-cost when idle and aligns naturally with the rate
// limits we're guarding (openFDA: 240/min, RxNav: 20/sec).
export class RateLimiter {
  private readonly tokensPerInterval: number;
  private readonly intervalMs: number;
  private readonly maxBurst: number;
  private tokens: number;
  private lastRefill: number;
  private readonly queue: Array<() => void> = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: RateLimiterOptions) {
    if (opts.tokensPerInterval <= 0) {
      throw new RangeError('tokensPerInterval must be > 0');
    }
    if (opts.intervalMs <= 0) {
      throw new RangeError('intervalMs must be > 0');
    }
    this.tokensPerInterval = opts.tokensPerInterval;
    this.intervalMs = opts.intervalMs;
    this.maxBurst = opts.maxBurst ?? opts.tokensPerInterval;
    this.tokens = this.maxBurst;
    this.lastRefill = Date.now();
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  acquire(): Promise<void> {
    if (this.tryAcquire()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.scheduleDrain();
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const refilled = (elapsed * this.tokensPerInterval) / this.intervalMs;
    this.tokens = Math.min(this.maxBurst, this.tokens + refilled);
    this.lastRefill = now;
  }

  private scheduleDrain(): void {
    if (this.drainTimer !== null) return;
    const tokensNeeded = Math.max(0, 1 - this.tokens);
    const delay = Math.max(
      1,
      Math.ceil((tokensNeeded * this.intervalMs) / this.tokensPerInterval),
    );
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drain();
    }, delay);
  }

  private drain(): void {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      const resolve = this.queue.shift();
      if (!resolve) break;
      this.tokens -= 1;
      resolve();
    }
    if (this.queue.length > 0) this.scheduleDrain();
  }
}

// 240 req/min matches openFDA's anonymous-tier ceiling. We don't pursue an
// API key in v1 (see project memo); if traffic ever forces it, raise both
// this number and add the api_key query param at the http layer.
export const openFdaLimiter = new RateLimiter({
  tokensPerInterval: 240,
  intervalMs: 60_000,
});

// 20 req/sec is conservative — RxNav doesn't publish a documented limit,
// but historical guidance from NLM staff tops out around this rate. Keeping
// well under the threshold avoids correlated failures across CI workers.
export const rxNavLimiter = new RateLimiter({
  tokensPerInterval: 20,
  intervalMs: 1_000,
});
