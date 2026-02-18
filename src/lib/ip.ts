/**
 * Check if an IP address falls within a CIDR range.
 * Supports IPv4 only for campus network checks.
 */
function ipToLong(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return -1;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr, 10);

  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipLong = ipToLong(ip);
  const rangeLong = ipToLong(rangeIp);

  if (ipLong === -1 || rangeLong === -1) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipLong & mask) === (rangeLong & mask);
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
