import dns from "node:dns";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { HttpError } from "./security.js";
import { config } from "./config.js";

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF / TEST-NET-1
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113); // TEST-NET-2/3
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  if (/^::(\d+\.){3}\d+$/.test(v)) return true; // IPv4-compatible
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff") ||
    v.startsWith("64:ff9b:") || v.startsWith("2002:") || v.startsWith("100:"); // NAT64, 6to4, discard
}

/**
 * dns.lookup replacement used for every outbound identity-provider request.
 * Checking at connection time pins the decision to the address actually used,
 * which closes the DNS-rebinding gap between a separate check and the request.
 */
export function safeLookup(hostname, options, callback) {
  if (typeof options === "function") { callback = options; options = {}; }
  const opts = typeof options === "number" ? { family: options } : { ...options };
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return callback(err);
    if (!config.allowPrivateIssuer && addrs.some((a) => isPrivateIp(a.address))) {
      const e = new Error(`Blocked request to a private address for ${hostname}`);
      e.code = "EBLOCKED";
      return callback(e);
    }
    if (opts.all) return callback(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
}

// Shared multi-tenant Microsoft endpoints accept tokens from any tenant.
const MULTI_TENANT = /^https:\/\/login\.microsoftonline\.com\/(common|organizations|consumers)(\/|$)/i;

/**
 * Validates an identity-provider URL: public HTTPS host only. Used for the issuer an admin
 * types and for every endpoint the provider's discovery document returns.
 * Self-hosters with an internal IdP can opt out with ALLOW_PRIVATE_SSO_ISSUER=true.
 */
export async function assertPublicHttpsUrl(raw, what = "issuer") {
  let url;
  try { url = new URL(raw); } catch { throw new HttpError(400, `Invalid ${what} URL.`, "bad_issuer"); }
  if (url.protocol !== "https:") throw new HttpError(400, `The ${what} must use HTTPS.`, "bad_issuer");
  if (url.username || url.password) throw new HttpError(400, `Invalid ${what} URL.`, "bad_issuer");
  if (what === "issuer" && MULTI_TENANT.test(url.href)) {
    throw new HttpError(400, "Use your tenant-specific issuer (https://login.microsoftonline.com/<tenant-id>/v2.0), not a shared multi-tenant endpoint.", "multi_tenant_issuer");
  }
  if (config.allowPrivateIssuer) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(400, `The ${what} host could not be resolved.`, "bad_issuer");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, `The ${what} must be a public host.`, "bad_issuer");
  return url;
}
