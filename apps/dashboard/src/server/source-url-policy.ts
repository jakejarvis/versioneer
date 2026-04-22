const DNS_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

export class SourceUrlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceUrlPolicyError";
  }
}

export interface SourceUrlPolicyOptions {
  resolveAddresses?: (hostname: string) => Promise<string[]>;
}

interface DnsJsonResponse {
  Answer?: Array<{ data?: string }>;
}

export async function assertValidSourceFetchUrl(
  rawUrl: string,
  options: SourceUrlPolicyOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SourceUrlPolicyError("Source validation URL is invalid");
  }

  if (url.protocol !== "https:") {
    throw new SourceUrlPolicyError("Source validation only allows https URLs");
  }

  const hostname = normalizeHostname(url.hostname);
  if (isBlockedHostname(hostname) || isBlockedAddress(hostname)) {
    throw new SourceUrlPolicyError("Source validation URL resolves to a blocked host");
  }

  if (options.resolveAddresses) {
    const addresses = await options.resolveAddresses(hostname);
    if (addresses.length === 0) {
      throw new SourceUrlPolicyError("Source validation URL did not resolve to a public address");
    }
    const blockedAddress = addresses.find((address) =>
      isBlockedAddress(normalizeHostname(address)),
    );
    if (blockedAddress) {
      throw new SourceUrlPolicyError(
        `Source validation URL resolved to a blocked address (${blockedAddress})`,
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

async function resolveDnsType(hostname: string, type: "A" | "AAAA"): Promise<string[]> {
  const url = new URL(DNS_JSON_ENDPOINT);
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", type);

  const response = await fetch(url, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new SourceUrlPolicyError(`DNS lookup failed for ${hostname}`);
  }

  const body = (await response.json()) as DnsJsonResponse;
  return (body.Answer ?? [])
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
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("2001:db8:") || normalized === "2001:db8::") return true;

  const ipv4Mapped = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Mapped?.[1] && isBlockedIpv4(ipv4Mapped[1])) return true;

  const firstHextet = normalized
    .split(":")
    .find((part) => part.length > 0 && /^[0-9a-f]+$/.test(part));
  if (!firstHextet) return true;

  const value = Number.parseInt(firstHextet, 16);
  if ((value & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((value & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((value & 0xff00) === 0xff00) return true; // multicast ff00::/8
  return false;
}
