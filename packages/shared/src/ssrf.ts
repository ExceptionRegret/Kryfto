import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const BLOCKED_IPV4_RANGES = new Set([
  'private',
  'loopback',
  'linkLocal',
  'multicast',
  'broadcast',
  'carrierGradeNat',
  'reserved',
  'unspecified',
]);

const BLOCKED_IPV6_RANGES = new Set(['loopback', 'linkLocal', 'multicast', 'uniqueLocal', 'reserved', 'unspecified']);

export function parseAllowHosts(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isBlockedIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) {
    return true;
  }

  const parsed = ipaddr.parse(ip);
  if (parsed.kind() === 'ipv4') {
    return BLOCKED_IPV4_RANGES.has(parsed.range());
  }

  return BLOCKED_IPV6_RANGES.has(parsed.range());
}

export async function assertSafeUrl(input: string, opts: { blockPrivateRanges: boolean; allowHosts: Set<string> }): Promise<URL> {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }
  const host = url.hostname.toLowerCase();

  if (opts.allowHosts.has(host)) {
    return url;
  }

  if (!opts.blockPrivateRanges) {
    return url;
  }

  if (ipaddr.isValid(host) && isBlockedIp(host)) {
    throw new Error('Target host is blocked by SSRF policy');
  }

  const resolved = await dns.lookup(host, { all: true });
  for (const record of resolved) {
    if (isBlockedIp(record.address)) {
      throw new Error('Resolved address is blocked by SSRF policy');
    }
  }

  return url;
}
