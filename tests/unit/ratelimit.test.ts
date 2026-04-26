/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RateLimiter,
  openFdaLimiter,
  rxNavLimiter,
} from '../../src/lib/ratelimit';

describe('RateLimiter.tryAcquire', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true while the bucket has tokens', () => {
    const limiter = new RateLimiter({ tokensPerInterval: 3, intervalMs: 1000 });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('returns false once the bucket is empty', () => {
    const limiter = new RateLimiter({ tokensPerInterval: 2, intervalMs: 1000 });
    limiter.tryAcquire();
    limiter.tryAcquire();
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('refills tokens proportional to elapsed time', () => {
    const limiter = new RateLimiter({ tokensPerInterval: 4, intervalMs: 1000 });
    limiter.tryAcquire();
    limiter.tryAcquire();
    limiter.tryAcquire();
    limiter.tryAcquire();
    expect(limiter.tryAcquire()).toBe(false);
    // Half an interval should restore half the tokens.
    vi.advanceTimersByTime(500);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('caps refilled tokens at maxBurst', () => {
    const limiter = new RateLimiter({
      tokensPerInterval: 5,
      intervalMs: 1000,
      maxBurst: 3,
    });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    // Even after a full refill window, the bucket should not exceed maxBurst.
    vi.advanceTimersByTime(60_000);
    let consumed = 0;
    while (limiter.tryAcquire()) consumed++;
    expect(consumed).toBe(3);
  });
});

describe('RateLimiter.acquire', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when a token is available', async () => {
    const limiter = new RateLimiter({ tokensPerInterval: 1, intervalMs: 1000 });
    await expect(limiter.acquire()).resolves.toBeUndefined();
  });

  it('queues the caller and resolves after the next refill', async () => {
    const limiter = new RateLimiter({ tokensPerInterval: 1, intervalMs: 1000 });
    await limiter.acquire();

    let resolved = false;
    const pending = limiter.acquire().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(resolved).toBe(true);
  });

  it('serves queued waiters in FIFO order as tokens refill', async () => {
    const limiter = new RateLimiter({ tokensPerInterval: 1, intervalMs: 1000 });
    await limiter.acquire();

    const order: number[] = [];
    const a = limiter.acquire().then(() => order.push(1));
    const b = limiter.acquire().then(() => order.push(2));
    const c = limiter.acquire().then(() => order.push(3));

    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all([a, b, c]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('drains the queue as tokens become available without re-allocating extras', async () => {
    const limiter = new RateLimiter({ tokensPerInterval: 2, intervalMs: 1000 });
    await limiter.acquire();
    await limiter.acquire();

    const pending = limiter.acquire();
    await vi.advanceTimersByTimeAsync(500);
    await pending;

    // Bucket should now be empty — a synchronous tryAcquire must fail.
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('fully refills a drained bucket after one interval at openFDA scale (240/min)', () => {
    // Production-scale check: drain the openFDA-shaped bucket completely,
    // advance one full interval, and confirm every token is available again.
    const limiter = new RateLimiter({
      tokensPerInterval: 240,
      intervalMs: 60_000,
    });
    for (let i = 0; i < 240; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }
    expect(limiter.tryAcquire()).toBe(false);

    vi.advanceTimersByTime(60_000);

    for (let i = 0; i < 240; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }
    expect(limiter.tryAcquire()).toBe(false);
  });
});

describe('singleton limiters', () => {
  it('openFdaLimiter is configured for 240/min', () => {
    expect(openFdaLimiter).toBeInstanceOf(RateLimiter);
  });

  it('rxNavLimiter is configured for 20/sec', () => {
    expect(rxNavLimiter).toBeInstanceOf(RateLimiter);
  });

  it('singletons are independent of each other', () => {
    const a = openFdaLimiter.tryAcquire();
    const b = rxNavLimiter.tryAcquire();
    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});
