/**
 * Get the real client IP from request headers.
 *
 * IMPORTANT: Only use this if the server is behind a TRUSTED reverse proxy
 * (e.g., Vercel, Netlify, Render, or your own configured proxy).
 *
 * The following proxies are trusted by default:
 * - Vercel (x-forwarded-for)
 * - Render.com (x-forwarded-for)
 * - Netlify (x-forwarded-for via their infrastructure)
 *
 * For on-premises or custom proxies, ensure:
 * 1. The proxy strips/validates incoming X-Forwarded-For
 * 2. The proxy is configured to only accept requests from your app
 * 3. The proxy is the only entry point to your application
 *
 * @param headers - Request headers object
 * @returns Real client IP address, or "unknown" if unable to determine
 */
export function getClientIp(headers: Headers | Record<string, string | string[] | undefined>): string {
  // For typical cloud deployments (Vercel, Render, Netlify), x-forwarded-for is trusted
  const xForwardedFor = headers["x-forwarded-for"];
  if (xForwardedFor) {
    // Take the first IP in the chain (the real client)
    const ip = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor.split(",")[0];
    return ip.trim();
  }

  const xRealIp = headers["x-real-ip"];
  if (xRealIp) {
    const ip = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
    return ip.trim();
  }

  return "unknown";
}

/**
 * Check if an IPv4 address falls within a CIDR range.
 */
function ipv4ToLong(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return -1;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Check if an IPv6 address falls within a CIDR range.
 * Converts IPv6 to bigint for comparison.
 */
function ipv6ToBigInt(ip: string): bigint | null {
  try {
    // Normalize IPv6 address
    let normalized = ip.toLowerCase();

    // Handle IPv4-mapped IPv6 addresses (e.g., ::ffff:192.0.2.1)
    if (normalized.includes("::ffff:")) {
      const ipv4Part = normalized.slice(7);
      const ipv4Long = ipv4ToLong(ipv4Part);
      if (ipv4Long === -1) return null;
      return BigInt("0xffff00000000") | BigInt(ipv4Long);
    }

    // Convert IPv6 to 128-bit integer
    const parts = normalized.split(":");
    if (parts.length < 3 || parts.length > 8) return null;

    let result = 0n;
    let zeroGroupsSeen = false;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (part === "") {
        if (i === 0 || i === parts.length - 1) continue; // :: at start or end
        if (zeroGroupsSeen) return null; // Multiple :: not allowed
        zeroGroupsSeen = true;
        // Skip empty parts for :: expansion
        continue;
      }

      const value = parseInt(part, 16);
      if (isNaN(value) || value < 0 || value > 0xffff) return null;
      result = (result << 16n) | BigInt(value);
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Check if an IP address (IPv4 or IPv6) falls within a CIDR range.
 * Supports both IPv4 and IPv6 addresses.
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr, 10);

  if (isNaN(prefix) || prefix < 0) return false;

  // Determine if IPv4 or IPv6 and validate accordingly
  if (ip.includes(":") || rangeIp.includes(":")) {
    // IPv6 CIDR check
    if (prefix < 0 || prefix > 128) return false;

    const ipBigInt = ipv6ToBigInt(ip);
    const rangeBigInt = ipv6ToBigInt(rangeIp);

    if (ipBigInt === null || rangeBigInt === null) return false;

    if (prefix === 0) return true; // ::/0 matches any IPv6
    if (prefix === 128) return ipBigInt === rangeBigInt; // Single IPv6 address

    const mask = (BigInt(1) << BigInt(128 - prefix)) - BigInt(1);
    const maskedIp = ipBigInt >> BigInt(128 - prefix);
    const maskedRange = rangeBigInt >> BigInt(128 - prefix);

    return maskedIp === maskedRange;
  } else {
    // IPv4 CIDR check
    if (prefix < 0 || prefix > 32) return false;

    const ipLong = ipv4ToLong(ip);
    const rangeLong = ipv4ToLong(rangeIp);

    if (ipLong === -1 || rangeLong === -1) return false;

    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipLong & mask) === (rangeLong & mask);
  }
}

export function isIpTrusted(ip: string, trustedRanges: string[]): boolean {
  if (!ip || trustedRanges.length === 0) return false;

  const cleanIp = ip.includes(",") ? ip.split(",")[0].trim() : ip.trim();

  if (cleanIp.startsWith("::ffff:")) {
    const v4 = cleanIp.slice(7);
    return trustedRanges.some((range) => isIpInCidr(v4, range));
  }

  return trustedRanges.some((range) => isIpInCidr(cleanIp, range));
}
