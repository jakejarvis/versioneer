const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

export const sourceFetchFailureReasons = [
  "invalid_url",
  "non_https",
  "blocked_hostname",
  "dns_failed",
  "dns_no_public_addresses",
  "blocked_resolved_address",
  "timeout",
  "body_limit",
  "http_error",
  "network_error",
] as const;

export type SourceFetchFailureReason = (typeof sourceFetchFailureReasons)[number];

export class SourceUrlPolicyError extends Error {
  constructor(
    readonly reason: SourceFetchFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "SourceUrlPolicyError";
  }
}

export interface SourceUrlPolicyOptions {
  resolveAddresses?: (hostname: string) => Promise<string[]>;
}

export interface SourceFetchUrlMetadata {
  rawUrl: string;
  url: URL | null;
  hostname: string | null;
  scheme: string | null;
}

interface DnsJsonResponse {
  Answer?: Array<{ type?: number; data?: string }>;
}

export async function assertValidSourceFetchUrl(
  rawUrl: string,
  options: SourceUrlPolicyOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SourceUrlPolicyError("invalid_url", "Source fetch URL is invalid");
  }

  if (url.protocol !== "https:") {
    throw new SourceUrlPolicyError("non_https", "Source fetch only allows https URLs");
  }

  const hostname = normalizeHostname(url.hostname);
  if (isBlockedHostname(hostname) || isBlockedAddress(hostname)) {
    throw new SourceUrlPolicyError(
      "blocked_hostname",
      "Source fetch URL resolves to a blocked host",
    );
  }

  if (options.resolveAddresses) {
    let addresses: string[];
    try {
      addresses = await options.resolveAddresses(hostname);
    } catch (error) {
      if (error instanceof SourceUrlPolicyError) throw error;
      throw new SourceUrlPolicyError(
        "dns_failed",
        error instanceof Error ? error.message : "DNS lookup failed",
      );
    }

    if (addresses.length === 0) {
      throw new SourceUrlPolicyError(
        "dns_no_public_addresses",
        "Source fetch URL did not resolve to a public address",
      );
    }

    const blockedAddress = addresses.find((address) =>
      isBlockedAddress(normalizeHostname(address)),
    );
    if (blockedAddress) {
      throw new SourceUrlPolicyError(
        "blocked_resolved_address",
        `Source fetch URL resolved to a blocked address (${blockedAddress})`,
      );
    }
  }

  return url;
}

export async function resolvePublicDnsAddresses(hostname: string): Promise<string[]> {
  const normalized = normalizeHostname(hostname);
  const [ipv4, ipv6] = await Promise.all([
    resolveDnsType(normalized, "A"),
    resolveDnsType(normalized, "AAAA"),
  ]);
  return [...ipv4, ...ipv6];
}

export function isGitHubApiUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && normalizeHostname(url.hostname) === "api.github.com";
  } catch {
    return false;
  }
}

export function getSourceFetchUrlMetadata(rawUrl: string): SourceFetchUrlMetadata {
  try {
    const url = new URL(rawUrl);
    return {
      rawUrl,
      url,
      hostname: normalizeHostname(url.hostname),
      scheme: url.protocol.replace(/:$/, "").toLowerCase(),
    };
  } catch {
    return { rawUrl, url: null, hostname: null, scheme: null };
  }
}

async function resolveDnsType(hostname: string, type: "A" | "AAAA"): Promise<string[]> {
  const url = new URL(DNS_JSON_ENDPOINT);
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", type);

  const response = await fetch(url, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new SourceUrlPolicyError("dns_failed", `DNS lookup failed for ${hostname}`);
  }

  const body = (await response.json()) as DnsJsonResponse;
  const expectedType = type === "A" ? 1 : 28;
  return (body.Answer ?? [])
    .filter((answer) => answer.type === expectedType)
    .map((answer) => answer.data)
    .filter((address): address is string => typeof address === "string" && address.length > 0);
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function isBlockedHostname(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "metadata.google.internal") return true;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return true;
  if (/^(?:\d+|0x[0-9a-f]+)$/i.test(hostname)) return true;
  return false;
}

function isBlockedAddress(address: string): boolean {
  return isBlockedIpv4(address) || isBlockedIpv6(address);
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;

  const [a, b] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 224 || a >= 240) return true;
  return (
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113)
  );
}

function isBlockedIpv6(address: string): boolean {
  if (!address.includes(":")) return false;
  const normalized = address.toLowerCase();
  const hextets = parseIpv6Hextets(normalized);
  if (!hextets) return true;

  const isAllZero = hextets.every((hextet) => hextet === 0);
  const isLoopback = hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1;
  if (isAllZero || isLoopback) return true;

  const isIpv4Mapped = hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff;
  if (isIpv4Mapped) return true;

  const value = hextets[0]!;
  if (value === 0x2001 && hextets[1] === 0x0db8) return true;
  if ((value & 0xfe00) === 0xfc00) return true;
  if ((value & 0xffc0) === 0xfe80) return true;
  if ((value & 0xff00) === 0xff00) return true;
  return false;
}

function parseIpv6Hextets(address: string): number[] | null {
  if (address.includes(".")) {
    const ipv4Mapped = address.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (ipv4Mapped?.[1] && isBlockedIpv4(ipv4Mapped[1])) return Array(8).fill(0);
    return null;
  }

  const parts = address.split("::");
  if (parts.length > 2) return null;

  const left = splitIpv6Side(parts[0] ?? "");
  const right = splitIpv6Side(parts[1] ?? "");
  if (!left || !right) return null;

  if (parts.length === 1) {
    return left.length === 8 ? left : null;
  }

  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function splitIpv6Side(side: string): number[] | null {
  if (!side) return [];
  const hextets: number[] = [];
  for (const part of side.split(":")) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    hextets.push(Number.parseInt(part, 16));
  }
  return hextets;
}
