import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { apiError } from './errors.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis | null;
  private readonly buckets = new Map<string, { count: number; until: number }>();

  constructor() {
    const url = process.env.REDIS_URL;
    this.client = url && !url.startsWith('memory:') ? new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true, enableOfflineQueue: false }) : null;
    this.client?.on('error', () => { /* No connection strings or secrets in logs. */ });
  }

  async connect() {
    if (!this.client) return;
    if (this.client.status === 'wait') await this.client.connect();
    if (this.client.status === 'connecting' || this.client.status === 'connect') {
      const client = this.client;
      await new Promise<void>((resolve, reject) => {
        const ready = () => { cleanup(); resolve(); };
        const fail = () => { cleanup(); reject(apiError(503, 'RATE_LIMIT_UNAVAILABLE', '限流服务暂时不可用')); };
        const cleanup = () => { client.off('ready', ready); client.off('error', fail); };
        client.once('ready', ready); client.once('error', fail);
      });
    }
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<{ remaining: number; retryAfter: number }> {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) throw apiError(503, 'INVALID_RATE_LIMIT', '服务限额配置错误');
    try {
      if (!this.client) {
        const now = Date.now();
        if (this.buckets.size > 10_000) for (const [bucketKey, value] of this.buckets) if (value.until <= now) this.buckets.delete(bucketKey);
        let bucket = this.buckets.get(key);
        if (!bucket || bucket.until <= now) { bucket = { count: 0, until: now + windowSeconds * 1000 }; this.buckets.set(key, bucket); }
        bucket.count++;
        const retryAfter = Math.max(1, Math.ceil((bucket.until - now) / 1000));
        if (bucket.count > limit) throw apiError(429, 'RATE_LIMITED', `请求过于频繁，请在 ${retryAfter} 秒后重试`);
        return { remaining: limit - bucket.count, retryAfter };
      }
      await this.connect();
      const result = await this.client.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('TTL',KEYS[1])}", 1, `rate:${key}`, windowSeconds) as [number, number];
      if (result[0] > limit) throw apiError(429, 'RATE_LIMITED', `请求过于频繁，请在 ${Math.max(1, result[1])} 秒后重试`);
      return { remaining: Math.max(0, limit - result[0]), retryAfter: Math.max(1, result[1]) };
    } catch (error: any) {
      if (typeof error?.getStatus === 'function') throw error;
      throw apiError(503, 'RATE_LIMIT_UNAVAILABLE', '限流服务暂时不可用');
    }
  }

  async onModuleDestroy() { if (this.client && this.client.status !== 'end') this.client.disconnect(); this.buckets.clear(); }
}
