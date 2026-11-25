const PROJECT_ID = "aniwave-3fb23";
const BUNNY_LIBRARY_ID = "820948";
const BUNNY_CDN_HOST = "vz-1db794dd-dbb.b-cdn.net";
const MAX_TITLE_LENGTH = 180;
const UPLOAD_TTL_SECONDS = 6 * 60 * 60;
const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let jwksCache = { keys: [], expiresAt: 0 };

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || "https://tnartz.github.io").split(",").map(x => x.trim());
  const headers = { "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function getFirebaseKey(kid) {
  if (Date.now() > jwksCache.expiresAt || !jwksCache.keys.length) {
    const response = await fetch(FIREBASE_JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!response.ok) throw new Error("Could not retrieve Firebase signing keys");
    const data = await response.json();
    jwksCache = { keys: data.keys || [], expiresAt: Date.now() + 3600 * 1000 };
  }
  return jwksCache.keys.find(key => key.kid === kid && key.kty === "RSA" && key.alg === "RS256");
}

async function requireAdmin(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\\s+(.+)$/i);
  if (!match) return false;
  try {
    const parts = match[1].split(".");
    if (parts.length !== 3) return false;
    const headerData = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    if (headerData.alg !== "RS256" || !headerData.kid) return false;
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== "https://securetoken.google.com/" + PROJECT_ID ||
        claims.aud !== PROJECT_ID || claims.admin !== true ||
        typeof claims.sub !== "string" || claims.sub.length < 1 ||
        !Number.isFinite(claims.exp) || claims.exp <= now ||
        !Number.isFinite(claims.iat) || claims.iat > now + 60) return false;
    const jwk = await getFirebaseKey(headerData.kid);
    if (!jwk) return false;
    const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, decodeBase64Url(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (origin && !headers["Access-Control-Allow-Origin"]) return json({ error: "Origin not allowed" }, 403, headers);
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/api/create-upload") return json({ error: "Not found" }, 404, headers);
    if (!await requireAdmin(request)) return json({ error: "Admin authentication required" }, 403, headers);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, headers); }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 2 || title.length > MAX_TITLE_LENGTH) return json({ error: "Название должно содержать от 2 до 180 символов." }, 400, headers);
    if (!env.BUNNY_STREAM_API_KEY) return json({ error: "Bunny API secret is not configured." }, 500, headers);

    let bunnyResponse;
    try {
      bunnyResponse = await fetch("https://video.bunnycdn.com/library/" + BUNNY_LIBRARY_ID + "/videos", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json", "AccessKey": env.BUNNY_STREAM_API_KEY },
        body: JSON.stringify({ title })
      });
    } catch {
      return json({ error: "Не удалось связаться с Bunny Stream." }, 502, headers);
    }
    const video = await bunnyResponse.json().catch(() => ({}));
    if (!bunnyResponse.ok || !video.guid) return json({ error: "Bunny Stream не смог создать видеозапись." }, 502, headers);

    const expirationTime = Math.floor(Date.now() / 1000) + UPLOAD_TTL_SECONDS;
    const signatureSource = BUNNY_LIBRARY_ID + env.BUNNY_STREAM_API_KEY + expirationTime + video.guid;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signatureSource));
    const signature = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");

    return json({
      videoId: video.guid,
      libraryId: BUNNY_LIBRARY_ID,
      expirationTime,
      signature,
      tusEndpoint: "https://video.bunnycdn.com/tusupload",
      playbackUrl: "https://" + BUNNY_CDN_HOST + "/" + video.guid + "/playlist.m3u8"
    }, 200, headers);
  }
};
