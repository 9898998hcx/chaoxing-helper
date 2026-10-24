import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlSource, canonicalUrl, sourcePermitted, type EnginePorts, type Metadata, type Source } from '../apps/worker/src/engine.ts';
import { allowedUrl, isPublicAddress, publicAddresses } from '../apps/worker/src/security.ts';
import { waitForSourceSlot } from '../apps/worker/src/rate-limit.ts';

const source: Source = { id: 'source-a', baseUrl: 'https://example.com/', tosUrl: 'https://example.com/terms', tosEvidence: 'Written permission for public metadata, recorded 2026-10-22.', enabled: true, permissionConfirmed: true, robotsRequired: true, rateLimitMs: 3000, metadataPath: '/metadata.json' };
const metadata: Metadata = { title: 'Engineering structure', sourceUrl: 'https://example.com/structure/1', tags: ['engineering'], style: 'professional', layout: 'single-column', sectionOrder: ['basic', 'work', 'education'] };
function fixture(options: { robots?: string; robotStatus?: number; rows?: unknown[]; jsonStatus?: number } = {}) {
  const requests: string[] = []; const waits: number[] = []; const stored: any[] = [];
  const ports: EnginePorts = {
    isEnabled: () => true,
    waitForSlot: async (_id, delay) => { waits.push(delay); },
    store: async row => { stored.push(row); return true; },
    fetch: async (url, _base, requestOptions) => {
      await requestOptions?.beforeRequest?.(url); requests.push(url);
      return url.endsWith('/robots.txt')
        ? { status: options.robotStatus ?? 200, text: options.robots ?? 'User-agent: *\nAllow: /', contentType: 'text/plain; charset=utf-8' }
        : { status: options.jsonStatus ?? 200, text: JSON.stringify({ templates: options.rows ?? [metadata] }), contentType: 'application/json' };
    },
  };
  return { ports, requests, waits, stored };
}

test('crawler disabled does not make any network request', async () => {
  const f = fixture(); f.ports.isEnabled = () => false;
  assert.deepEqual(await crawlSource(source, f.ports), { status: 'SKIPPED', reason: 'CRAWLER_DISABLED', processedCount: 0 });
  assert.equal(f.requests.length, 0);
});
test('unconfirmed permission and absent ToS evidence fail closed', async () => {
  assert.equal(sourcePermitted({ ...source, tosEvidence: '' }), false);
  for (const modified of [{ enabled: false }, { permissionConfirmed: false }, { tosEvidence: '' }, { robotsRequired: false }]) {
    const f = fixture();
    assert.equal((await crawlSource({ ...source, ...modified }, f.ports)).status, 'SKIPPED');
    assert.equal(f.requests.length, 0);
  }
});
test('robots prohibition skips metadata fetch', async () => {
  const f = fixture({ robots: 'User-agent: *\nDisallow: /metadata.json' });
  assert.equal((await crawlSource(source, f.ports)).reason, 'ROBOTS_DENIED');
  assert.deepEqual(f.requests, ['https://example.com/robots.txt']);
  assert.equal(f.stored.length, 0);
});
test('missing and malformed robots skip collection', async () => {
  for (const options of [{ robotStatus: 404 }, { robots: '<html>login page</html>' }, { robots: '' }]) {
    const f = fixture(options);
    assert.equal((await crawlSource(source, f.ports)).reason, 'ROBOTS_UNAVAILABLE');
    assert.equal(f.requests.length, 1);
  }
});
test('per-source minimum interval and robots crawl-delay applied to every request', async () => {
  const f = fixture({ robots: 'User-agent: ResumeStructureBot\nAllow: /\nCrawl-delay: 8' });
  assert.equal((await crawlSource(source, f.ports)).status, 'SUCCEEDED');
  assert.deepEqual(f.waits, [3000, 8000]);
});
test('excessively long robots delay skips safely instead of shortening the required interval', async () => {
  const f = fixture({ robots: 'User-agent: *\nAllow: /\nCrawl-delay: 86400' });
  assert.equal((await crawlSource(source, f.ports)).reason, 'ROBOTS_DELAY_TOO_LONG');
  assert.equal(f.requests.length, 1);
});
test('Redis rate slot uses persisted per-source key and waits reserved interval', async () => {
  const captured: unknown[][] = []; const slept: number[] = [];
  await waitForSourceSlot({ eval: async (...args) => { captured.push(args); return 4200; } }, source.id, 500, async ms => { slept.push(ms); });
  assert.deepEqual(captured[0].slice(1), [1, 'crawler:source:source-a:last-request', 3000]);
  assert.deepEqual(slept, [4200]);
});
test('duplicate canonical metadata URLs are stored only once', async () => {
  const f = fixture({ rows: [metadata, { ...metadata, sourceUrl: `${metadata.sourceUrl}?utm_source=copy` }] });
  const result = await crawlSource(source, f.ports);
  assert.equal(result.processedCount, 1);
  assert.equal(f.stored.length, 1);
  assert.match(f.stored[0].slug, /^ref-[0-9a-f]{24}$/);
});
test('already-known metadata is not counted or resurrected', async () => {
  const f = fixture(); f.ports.store = async () => false;
  assert.equal((await crawlSource(source, f.ports)).processedCount, 0);
});
test('strict metadata whitelist drops copyrighted body and source-file fields', async () => {
  const f = fixture({ rows: [{ ...metadata, body: 'Full copyrighted template text' }, { ...metadata, downloadUrl: 'https://example.com/template.docx' }] });
  assert.equal((await crawlSource(source, f.ports)).processedCount, 0);
  assert.equal(f.stored.length, 0);
});
test('at most twenty metadata rows processed, no image fetches', async () => {
  const f = fixture({ rows: Array.from({ length: 30 }, (_, n) => ({ ...metadata, sourceUrl: `https://example.com/structure/${n}`, thumbnailUrl: 'https://cdn.example.com/thumb.jpg' })) });
  assert.equal((await crawlSource(source, f.ports)).processedCount, 20);
  assert.equal(f.requests.length, 2);
});
test('401/403/429 require access; worker never bypasses login/captcha/rate-limit', async () => {
  for (const jsonStatus of [401, 403, 429]) {
    const f = fixture({ jsonStatus });
    assert.equal((await crawlSource(source, f.ports)).reason, 'SOURCE_ACCESS_RESTRICTED');
    assert.equal(f.requests.length, 2);
  }
});
test('source permission revoked before request stops further collection', async () => {
  const f = fixture(); let checks = 0;
  f.ports.mayProceed = async () => ++checks <= 2;
  assert.equal((await crawlSource(source, f.ports)).reason, 'CRAWLER_DISABLED');
  assert.equal(f.requests.length, 1);
});
test('private, mapped, local, metadata and transition IP ranges are blocked', () => {
  for (const value of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2001:0000:1::1', '2002:7f00:1::']) assert.equal(isPublicAddress(value), false, value);
  for (const value of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicAddress(value), true, value);
});
test('cross-origin, out-of-scope, encoded loopback and credential URLs rejected', () => {
  for (const value of ['https://other.example/metadata', 'https://user:pass@example.com/metadata', 'ftp://example.com/a']) assert.throws(() => allowedUrl(value, source.baseUrl));
  assert.throws(() => allowedUrl('https://example.com/private', 'https://example.com/public/'));
  assert.throws(() => allowedUrl('https://example.com/public/%2e%2e%2fprivate', 'https://example.com/public/'));
  assert.throws(() => allowedUrl('http://2130706433/metadata', 'http://127.0.0.1/'));
  assert.throws(() => allowedUrl('https://localhost/data', 'https://localhost/'));
});
test('DNS mixed public/private answers fail closed before creating an outbound connector', async () => {
  await assert.rejects(publicAddresses('example.com', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]), /PRIVATE_ADDRESS_BLOCKED/);
  await assert.rejects(publicAddresses('example.com', async () => []), /PRIVATE_ADDRESS_BLOCKED/);
  assert.deepEqual(await publicAddresses('example.com', async () => [{ address: '8.8.8.8', family: 4 }]), [{ address: '8.8.8.8', family: 4 }]);
});
test('canonical URL preserves meaningful query and drops trackers', () => {
  assert.equal(canonicalUrl('https://example.com/a?z=2&utm_source=x&a=1#fragment'), 'https://example.com/a?a=1&z=2');
});
