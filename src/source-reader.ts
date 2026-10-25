import {createHash} from "node:crypto";
import {lookup} from "node:dns/promises";
import {isIP} from "node:net";
import type {SourceDocument} from "./contracts.js";

function isPrivateIp(address: string): boolean {
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  const octets = address.split(".").map(Number);
  if (octets.length !== 4) return false;
  const [first = -1, second = -1] = octets;
  return first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first === 0;
}

function htmlToText(html: string): string {
  return html
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/&nbsp;/giu, " ")
    .replaceAll(/&amp;/giu, "&")
    .replaceAll(/&lt;/giu, "<")
    .replaceAll(/&gt;/giu, ">")
    .replaceAll(/&quot;/giu, '"')
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export async function readSource(
  sourceUrl: string,
  allowedHosts: ReadonlySet<string>,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch
): Promise<SourceDocument> {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:") throw new Error("SOURCE_HTTPS_REQUIRED");
  if (isIP(url.hostname) || !allowedHosts.has(url.hostname.toLowerCase())) throw new Error("SOURCE_HOST_NOT_ALLOWED");
  const addresses = await lookup(url.hostname, {all: true, verbatim: true});
  if (addresses.length === 0 || addresses.some(({address}) => isPrivateIp(address))) throw new Error("SOURCE_ADDRESS_NOT_PUBLIC");

  const response = await fetchImpl(url, {
    redirect: "error",
    headers: {"user-agent": "sistema-agentico-24x7/1.0 (+https://doctrinadigital.com)"},
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) throw new Error("SOURCE_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("SOURCE_TOO_LARGE");
  const raw = new TextDecoder("utf-8", {fatal: false}).decode(bytes);
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/json")) {
    throw new Error("SOURCE_CONTENT_TYPE_NOT_ALLOWED");
  }
  const title = raw.match(/<title[^>]*>([^<]+)<\/title>/iu)?.[1]?.trim() ?? url.hostname;
  const text = contentType.includes("text/html") ? htmlToText(raw) : raw.trim();
  return {
    url: url.toString(),
    title,
    retrievedAt: new Date().toISOString(),
    contentType,
    text: text.slice(0, 200_000),
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}
