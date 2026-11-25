import { createRemoteJWKSet, jwtVerify } from "jose";

const PROJECT_ID = "aniwave-3fb23";
const BUNNY_LIBRARY_ID = "820948";
const BUNNY_CDN_HOST = "vz-1db794dd-dbb.b-cdn.net";
const MAX_TITLE_LENGTH = 180;
const UPLOAD_TTL_SECONDS = 6 * 60 * 60;
const FIREBASE_KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || "https://tnartz.github.io").split(",").map(x => x.trim());
  const headers = { "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

async function requireAdmin(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  try {
    const { payload } = await jwtVerify(match[1], FIREBASE_KEYS, {
      issuer: "https://securetoken.google.com/" + PROJECT_ID,
      audience: PROJECT_ID
    });
    return payload.admin === true && typeof payload.sub === "string" && payload.sub.length > 0;
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
    if (request.method !== "POST" || url.pathname !== "/api/create-upload") {
      return json({ error: "Not found" }, 404, headers);
    }
    if (!await requireAdmin(request)) return json({ error: "Admin authentication required" }, 403, headers);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, headers); }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 2 || title.length > MAX_TITLE_LENGTH) {
      return json({ error: "Название должно содержать от 2 до 180 символов." }, 400, headers);
    }
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
    if (!bunnyResponse.ok || !video.guid) {
      return json({ error: "Bunny Stream не смог создать видеозапись." }, 502, headers);
    }

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
