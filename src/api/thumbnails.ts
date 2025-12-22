import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
// import path from "node:path";
import { getAssetDiskPath, getAssetPath, getAssetURL, mediaTypeToExt } from "./assets";
import { randomBytes } from "node:crypto";

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const video = await getVideo(cfg.db, videoId);
  if (!video) {
      throw new NotFoundError("Video not found");
  }

  if (video.userID !== userID) {
      throw new UserForbiddenError("User is not the owner of this video");
  }

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  const MAX_UPLOAD_SIZE = 10 << 20; // 10485760

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(`Thumbnail file exceeds maximum upload size of ${MAX_UPLOAD_SIZE} (bytes)`);
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }

  const assetPath = getAssetPath(mediaType);
  const assetDiskPath = getAssetDiskPath(cfg, assetPath); 

  await Bun.write(assetDiskPath, file);

   
  const urlPath = getAssetURL(cfg, assetPath);
  video.thumbnailURL = urlPath;

  await updateVideo(cfg.db, video);
  
  return respondWithJSON(200, video);
};