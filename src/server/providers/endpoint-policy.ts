import net from "node:net";
import { isPreviewOrProductionDeployment } from "@/server/runtime-config";

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function ipv4Octets(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts as [number, number, number, number];
}

function isPrivateIpv4(address: string) {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [first, second, third] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113)
  );
}

function isPrivateIpv6(address: string) {
  const lower = normalizeHostname(address);
  const mappedIpv4 = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4[1]);
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("2001:db8:") || lower === "2001:db8::") return true;

  const firstSegment = Number.parseInt(lower.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstSegment)) return false;
  return (
    (firstSegment >= 0xfc00 && firstSegment <= 0xfdff) ||
    (firstSegment >= 0xfe80 && firstSegment <= 0xfebf) ||
    (firstSegment >= 0xff00 && firstSegment <= 0xffff)
  );
}

export function isLocalOrPrivateEndpointHost(hostname: string) {
  const lower = normalizeHostname(hostname);
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;

  const family = net.isIP(lower);
  if (family === 4) return isPrivateIpv4(lower);
  if (family === 6) return isPrivateIpv6(lower);
  return false;
}

export function assertDeploymentFetchEndpoint(endpoint: string, label: string) {
  if (!isPreviewOrProductionDeployment()) return;

  const url = new URL(endpoint);
  if (isLocalOrPrivateEndpointHost(url.hostname)) {
    throw new Error(`${label} must not point to a local or private network endpoint in preview/production.`);
  }
}
