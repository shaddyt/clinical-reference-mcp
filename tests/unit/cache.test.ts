/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TtlCache, openFdaCache, rxNormCache } from '../../src/lib/cache';

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips set and get for the same key', () => {
    const cache = new TtlCache<string>({ max: 10, ttlMs: 1000 });
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
  });

  it('returns undefined for missing keys', () => {
    const cache = new TtlCache<string>({ max: 10, ttlMs: 1000 });
    expect(cache.get('missing')).toBeUndefined();
  });

  it('has() reflects presence and absence', () => {
    const cache = new TtlCache<number>({ max: 10, ttlMs: 1000 });
    expect(cache.has('k')).toBe(false);
    cache.set('k', 1);
    expect(cache.has('k')).toBe(true);
  });

  it('delete() returns true when key existed and removes it', () => {
    const cache = new TtlCache<number>({ max: 10, ttlMs: 1000 });
    cache.set('k', 1);
    expect(cache.delete('k')).toBe(true);
    expect(cache.has('k')).toBe(false);
  });

  it('delete() returns false when key did not exist', () => {
    const cache = new TtlCache<number>({ max: 10, ttlMs: 1000 });
    expect(cache.delete('missing')).toBe(false);
  });

  it('clear() empties the cache', () => {
    const cache = new TtlCache<number>({ max: 10, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
  });

  it('size reflects current entry count', () => {
    const cache = new TtlCache<number>({ max: 10, ttlMs: 1000 });
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
  });

  it('expires entries after the configured TTL', () => {
    const cache = new TtlCache<string>({ max: 10, ttlMs: 1000 });
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
    vi.advanceTimersByTime(1001);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.has('k')).toBe(false);
  });

  it('does not expire entries before the TTL elapses', () => {
    const cache = new TtlCache<string>({ max: 10, ttlMs: 1000 });
    cache.set('k', 'v');
    vi.advanceTimersByTime(999);
    expect(cache.get('k')).toBe('v');
  });

  it('evicts the least-recently-used entry when max is exceeded', () => {
    const cache = new TtlCache<number>({ max: 2, ttlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    // Touch 'a' so 'b' becomes LRU.
    cache.get('a');
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('overwrites existing values for the same key without growing size', () => {
    const cache = new TtlCache<number>({ max: 10, ttlMs: 1000 });
    cache.set('k', 1);
    cache.set('k', 2);
    expect(cache.size).toBe(1);
    expect(cache.get('k')).toBe(2);
  });
});

describe('singleton caches', () => {
  it('openFdaCache is a TtlCache instance', () => {
    expect(openFdaCache).toBeInstanceOf(TtlCache);
  });

  it('rxNormCache is a TtlCache instance', () => {
    expect(rxNormCache).toBeInstanceOf(TtlCache);
  });

  it('singletons are independent of each other', () => {
    openFdaCache.clear();
    rxNormCache.clear();
    openFdaCache.set('x', { v: 1 });
    expect(rxNormCache.has('x')).toBe(false);
    openFdaCache.clear();
  });
});
