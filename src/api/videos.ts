import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { getAssetDiskPath, getAssetPath } from "./assets";
import { randomBytes } from "crypto";
import { rm } from "node:fs/promises";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("Uploading video", videoId, "by user", userID);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
      throw new NotFoundError("Video not found");
  }

  if (video.userID !== userID) {
      throw new UserForbiddenError("User is not the owner of this video");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  const MAX_UPLOAD_SIZE = 1 << 30; // 1 GB
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(`Video file exceeds maximum upload size of ${MAX_UPLOAD_SIZE} (bytes)`);
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for video");
  }

  if (mediaType != "video/mp4") {
    throw new BadRequestError("Invalid video, expecting MP4 media file")
  }

  // Write the video asset (temporarily) to local storage
  const assetPath = getAssetPath(mediaType);
  const assetDiskPath = getAssetDiskPath(cfg, assetPath); 

  await Bun.write(assetDiskPath, file);

  //S3 handling

  // await cfg.s3Client.file(assetDiskPath);
  const key = `${randomBytes(32).toString("hex")}.mp4`
  // await cfg.s3Client.file(key, cfg.s3Bucket).write(Bun.file(assetDiskPath), mediaType);

  await cfg.s3Client.file(key, { bucket: cfg.s3Bucket }).write(Bun.file(assetDiskPath), { type: mediaType})
  
  // Delete the temporary video asset from local storage
  await rm(assetDiskPath, {force: true });

  // Update the videoURL in the database with the S3 bucket and key
  const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}` //getAssetURL(cfg, assetPath);
  video.videoURL = videoURL;

  await updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}