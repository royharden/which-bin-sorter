import type { PreparedImage } from "../../src/intake/reencode.ts";
import { buildJpeg } from "./jpeg.ts";

/** Encoder seam fixture; marker bytes are not a real decoded photograph. */
export function preparedImage(): PreparedImage {
  return { blob: new Blob([buildJpeg()], { type: "image/jpeg" }), bytes: buildJpeg(), image_b64: "/9j/",
    width: 640, height: 480, source_sha256: "a".repeat(64), upload_sha256: "b".repeat(64), preprocessing_version: "jpeg-1024-v1" };
}
