import { createHash } from 'node:crypto';
import robotsParser from 'robots-parser';
import { z } from 'zod';
import { allowedUrl, CrawlError, type SafeFetch } from './security.ts';

export const CRAWLER_USER_AGENT = 'ResumeStructureBot';
export type Source = { id: string; baseUrl: string; tosUrl: string; tosEvidence?: string | null; enabled: boolean; permissionConfirmed: boolean; robotsRequired: boolean; rateLimitMs: number; metadataPath?: string | null };
export type Metadata = { title: string; sourceUrl: string; tags: string[]; style: string; layout: string; sectionOrder: string[]; thumbnailUrl?: string; industry?: string };
export type CrawlResult = { status: 'SUCCEEDED' | 'SKIPPED' | 'FAILED'; reason?: string; processedCount: number };
export type EnginePorts = {
  fetch: SafeFetch;
  waitForSlot: (sourceId: string, delayMs: number) => Promise<void>;
  store: (metadata: Metadata & { slug: string }, source: Source) => Promise<boolean>;
  isEnabled: () => boolean;
  mayProceed?: () => Promise<boolean>;
};
const metadataSchema = z.object({
  title: z.string().trim().min(1).max(160), sourceUrl: z.string().url().max(2048),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  style: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), layout: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  sectionOrder: z.array(z.enum(['basic', 'intent', 'education', 'work', 'projects', 'skills', 'certificates', 'summary'])).min(1).max(8).refine(values => new Set(values).size === values.length),
  thumbnailUrl: z.string().url().max(2048).optional(), industry: z.string().trim().max(80).optional(),
}).strict();

export function canonicalUrl(value: string): string {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('utm_') || ['fbclid', 'gclid'].includes(key.toLowerCase())) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export function sourcePermitted(source: Source): boolean {
  return source.enabled && source.permissionConfirmed && !!source.tosEvidence?.trim() && !!source.tosUrl && source.robotsRequired && !!source.metadataPath && source.rateLimitMs >= 3000;
}
export async function crawlSource(source: Source, ports: EnginePorts): Promise<CrawlResult> {
  if (!ports.isEnabled()) return { status: 'SKIPPED', reason: 'CRAWLER_DISABLED', processedCount: 0 };
  if (!sourcePermitted(source)) return { status: 'SKIPPED', reason: 'SOURCE_NOT_AUTHORIZED', processedCount: 0 };
  let processedCount = 0;
  try {
    if (!source.metadataPath!.startsWith('/') || source.metadataPath!.startsWith('//') || source.metadataPath!.includes('\\')) throw new CrawlError('SOURCE_PATH_BLOCKED');
    const metadataUrl = allowedUrl(new URL(source.metadataPath!, source.baseUrl), source.baseUrl);
    const robotsUrl = new URL('/robots.txt', source.baseUrl).toString();
    const beforeRequest = async () => {
      if (!ports.isEnabled() || (ports.mayProceed && !await ports.mayProceed())) throw new CrawlError('CRAWLER_DISABLED');
      await ports.waitForSlot(source.id, source.rateLimitMs);
      if (!ports.isEnabled() || (ports.mayProceed && !await ports.mayProceed())) throw new CrawlError('CRAWLER_DISABLED');
    };
    const robots = await ports.fetch(robotsUrl, source.baseUrl, { robots: true, maxBytes: 65536, beforeRequest });
    // Missing, inaccessible or non-text robots fail closed, including 404.
    if (robots.status !== 200 || !robots.contentType.toLowerCase().includes('text/plain') || !/^\s*user-agent\s*:/im.test(robots.text)) return { status: 'SKIPPED', reason: 'ROBOTS_UNAVAILABLE', processedCount };
    const policy = robotsParser(robotsUrl, robots.text);
    if (policy.isAllowed(metadataUrl.toString(), CRAWLER_USER_AGENT) === false) return { status: 'SKIPPED', reason: 'ROBOTS_DENIED', processedCount };
    const crawlDelay = policy.getCrawlDelay(CRAWLER_USER_AGENT);
    if (crawlDelay !== undefined && (!Number.isFinite(Number(crawlDelay)) || Number(crawlDelay) > 3600)) return { status: 'SKIPPED', reason: 'ROBOTS_DELAY_TOO_LONG', processedCount };
    const metadataBeforeRequest = async (requestUrl: string) => {
      if (!ports.isEnabled() || (ports.mayProceed && !await ports.mayProceed())) throw new CrawlError('CRAWLER_DISABLED');
      if (policy.isAllowed(requestUrl, CRAWLER_USER_AGENT) === false) throw new CrawlError('ROBOTS_DENIED');
      await ports.waitForSlot(source.id, Math.max(source.rateLimitMs, Number(crawlDelay || 0) * 1000));
      if (!ports.isEnabled() || (ports.mayProceed && !await ports.mayProceed())) throw new CrawlError('CRAWLER_DISABLED');
    };
    const response = await ports.fetch(metadataUrl.toString(), source.baseUrl, { maxBytes: 256 * 1024, beforeRequest: metadataBeforeRequest });
    if (response.status === 401 || response.status === 403 || response.status === 429) return { status: 'SKIPPED', reason: 'SOURCE_ACCESS_RESTRICTED', processedCount };
    if (response.status !== 200 || !response.contentType.toLowerCase().includes('application/json')) throw new CrawlError('PUBLIC_METADATA_REQUIRED');
    let raw: unknown;
    try { raw = JSON.parse(response.text); } catch { throw new CrawlError('INVALID_METADATA'); }
    const envelope = z.object({ templates: z.array(z.unknown()).max(1000) }).strict().safeParse(raw);
    if (!envelope.success) throw new CrawlError('INVALID_METADATA');
    const seen = new Set<string>();
    for (const row of envelope.data.templates.slice(0, 20)) {
      if (!ports.isEnabled()) throw new CrawlError('CRAWLER_DISABLED');
      const parsed = metadataSchema.safeParse(row);
      if (!parsed.success) continue;
      const data = parsed.data;
      const url = canonicalUrl(allowedUrl(data.sourceUrl, source.baseUrl).toString());
      if (policy.isAllowed(url, CRAWLER_USER_AGENT) === false || seen.has(url)) continue;
      seen.add(url);
      // Store only the public thumbnail URL. Never retrieve image bytes or source files.
      if (data.thumbnailUrl) {
        const thumbnail = new URL(data.thumbnailUrl);
        if (thumbnail.protocol !== 'https:' || thumbnail.username || thumbnail.password) delete data.thumbnailUrl;
      }
      const slug = `ref-${createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
      if (await ports.store({ ...data, sourceUrl: url, slug }, source)) processedCount++;
    }
    return { status: 'SUCCEEDED', processedCount };
  } catch (error) {
    return { status: error instanceof CrawlError && ['PRIVATE_ADDRESS_BLOCKED', 'SOURCE_URL_BLOCKED', 'SOURCE_PATH_BLOCKED', 'CRAWLER_DISABLED', 'ROBOTS_DENIED'].includes(error.code) ? 'SKIPPED' : 'FAILED', reason: error instanceof CrawlError ? error.code : 'CRAWL_FAILED', processedCount };
  }
}
