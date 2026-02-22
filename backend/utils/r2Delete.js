import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "./r2.js";

export async function deleteR2Object(bucket, key) {
  if (!key) return;

  try {
    await r2.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );
  } catch (err) {
    console.error("R2 delete error:", err);
  }
}