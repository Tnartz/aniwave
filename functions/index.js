const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const crypto = require("node:crypto");
const admin = require("firebase-admin");

admin.initializeApp();

const BUNNY_STREAM_API_KEY = defineSecret("BUNNY_STREAM_API_KEY");
const BUNNY_LIBRARY_ID = "820948";
const FUNCTION_REGION = "europe-west1";
const UPLOAD_TTL_SECONDS = 6 * 60 * 60;

exports.createBunnyUpload = onCall(
  {
    region: FUNCTION_REGION,
    secrets: [BUNNY_STREAM_API_KEY],
    enforceAppCheck: false
  },
  async (request) => {
    if (!request.auth || request.auth.token.admin !== true) {
      throw new HttpsError("permission-denied", "Только администратор AniWave может загружать видео.");
    }

    const title = typeof request.data?.title === "string" ? request.data.title.trim() : "";
    if (title.length < 2 || title.length > 180) {
      throw new HttpsError("invalid-argument", "Название видео должно содержать от 2 до 180 символов.");
    }

    const apiKey = BUNNY_STREAM_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "На сервере не настроен ключ Bunny Stream.");
    }

    let response;
    try {
      response = await fetch(
        "https://video.bunnycdn.com/library/" + BUNNY_LIBRARY_ID + "/videos",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            AccessKey: apiKey
          },
          body: JSON.stringify({ title })
        }
      );
    } catch (error) {
      logger.error("Bunny create-video request failed", error);
      throw new HttpsError("unavailable", "Не удалось связаться с Bunny Stream.");
    }

    const video = await response.json().catch(() => ({}));
    if (!response.ok || !video.guid) {
      logger.error("Bunny create-video rejected", { status: response.status, body: video });
      throw new HttpsError("internal", "Bunny Stream не смог создать видеозапись.");
    }

    const expirationTime = Math.floor(Date.now() / 1000) + UPLOAD_TTL_SECONDS;
    const signature = crypto
      .createHash("sha256")
      .update(BUNNY_LIBRARY_ID + apiKey + expirationTime + video.guid)
      .digest("hex");

    return {
      videoId: video.guid,
      libraryId: BUNNY_LIBRARY_ID,
      expirationTime,
      signature,
      playbackUrl: "https://vz-1db794dd-dbb.b-cdn.net/" + video.guid + "/playlist.m3u8"
    };
  }
);
