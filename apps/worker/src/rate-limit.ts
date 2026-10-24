export interface RateRedis { eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown> }
const RESERVE = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local previous = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = math.max(now, previous + tonumber(ARGV[1]))
redis.call('SET', KEYS[1], slot, 'PX', math.max(86400000, slot - now + tonumber(ARGV[1]) + 60000))
return slot - now
`;
export async function waitForSourceSlot(redis: RateRedis, sourceId: string, delayMs: number, sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const waitMs = Number(await redis.eval(RESERVE, 1, `crawler:source:${sourceId}:last-request`, Math.max(3000, delayMs)));
  if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error('RATE_LIMIT_UNAVAILABLE');
  if (waitMs > 0) await sleep(waitMs);
}
