import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from './redis.service.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('Local memory limits', () => {
  it('limits per key, isolates users, and reopens after the window', async () => {
    vi.stubEnv('REDIS_URL', 'memory://');
    vi.useFakeTimers();
    const redis = new RedisService();
    expect(await redis.consume('alice', 1, 60)).toMatchObject({ remaining: 0 });
    await expect(redis.consume('alice', 1, 60)).rejects.toMatchObject({ status: 429 });
    expect(await redis.consume('bob', 1, 60)).toMatchObject({ remaining: 0 });
    vi.advanceTimersByTime(60_001);
    expect(await redis.consume('alice', 1, 60)).toMatchObject({ remaining: 0 });
    await redis.onModuleDestroy();
  });
});
