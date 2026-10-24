import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, request } from 'undici';

export class CrawlError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export function isPublicAddress(input: string): boolean {
  const address = input.toLowerCase().replace(/^\[|\]$/g, '');
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    // Only global unicast; exclude mapped IPv4, NAT64, documentation and transition ranges.
    const [first, second] = address.split(':').map(part => parseInt(part || '0', 16));
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff && !(first === 0x2001 && [0, 0xdb8].includes(second));
  }
  return false;
}
export function allowedUrl(input: string | URL, baseInput: string, robots = false): URL {
  let url: URL; let base: URL;
  try { url = new URL(input); base = new URL(baseInput); } catch { throw new CrawlError('INVALID_URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') || url.username || url.password || url.hash || url.origin !== base.origin || (url.port && !['80', '443'].includes(url.port))) throw new CrawlError('SOURCE_URL_BLOCKED');
  if (/%(?:2f|5c|00|25)/i.test(url.pathname)) throw new CrawlError('SOURCE_PATH_BLOCKED');
  const root = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  if (!robots && base.pathname !== '/' && url.pathname !== base.pathname && !url.pathname.startsWith(root)) throw new CrawlError('SOURCE_PATH_BLOCKED');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || (isIP(host) && !isPublicAddress(host))) throw new CrawlError('PRIVATE_ADDRESS_BLOCKED');
  return url;
}
export type SafeResponse = { status: number; text: string; contentType: string };
export type SafeFetch = (url: string, baseUrl: string, options?: { robots?: boolean; maxBytes?: number; beforeRequest?: (url: string) => Promise<void> }) => Promise<SafeResponse>;
export async function publicAddresses(host: string, resolve: (host: string) => Promise<{ address: string; family: number }[]> = value => lookup(value, { all: true, verbatim: true })) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
      resolve(host), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CrawlError('DNS_UNAVAILABLE')), 10000); }),
    ]);
    if (!addresses.length || addresses.some(address => !isPublicAddress(address.address))) throw new CrawlError('PRIVATE_ADDRESS_BLOCKED');
    return addresses;
  } catch (error) { if (error instanceof CrawlError) throw error; throw new CrawlError('DNS_UNAVAILABLE'); }
  finally { if (timer) clearTimeout(timer); }
}

/** Every redirect gets a fresh public-address check; the connector pins DNS to the checked IP. */
export const safeFetch: SafeFetch = async (input, baseUrl, options = {}) => {
  let url = allowedUrl(input, baseUrl, options.robots);
  const maxBytes = options.maxBytes ?? 256 * 1024;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await publicAddresses(host);
    const pinned = addresses[0];
    const dispatcher = new Agent({ connect: { lookup: ((_host: string, options: any, callback: any) => {
      if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
      else callback(null, pinned.address, pinned.family);
    }) as any } });
    try {
      await options.beforeRequest?.(url.toString());
      const response = await request(url, { dispatcher, method: 'GET', headersTimeout: 10000, bodyTimeout: 10000, signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'ResumeStructureBot/1.0 (+public-metadata-only)', accept: options.robots ? 'text/plain' : 'application/json' } });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.body.destroy();
        const location = response.headers.location;
        if (!location || redirects === 3) throw new CrawlError('REDIRECT_LIMIT');
        url = allowedUrl(new URL(Array.isArray(location) ? location[0] : location, url), baseUrl, options.robots);
        continue;
      }
      const length = Number(response.headers['content-length'] || 0);
      if (length > maxBytes) { response.body.destroy(); throw new CrawlError('RESPONSE_TOO_LARGE'); }
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > maxBytes) { response.body.destroy(); throw new CrawlError('RESPONSE_TOO_LARGE'); }
        chunks.push(Buffer.from(chunk));
      }
      return { status: response.statusCode, text: Buffer.concat(chunks).toString('utf8'), contentType: String(response.headers['content-type'] || '') };
    } catch (error) {
      if (error instanceof CrawlError) throw error;
      throw new CrawlError('FETCH_FAILED');
    } finally { await dispatcher.close(); }
  }
  throw new CrawlError('REDIRECT_LIMIT');
};
