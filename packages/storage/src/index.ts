import { env } from "@getficksd/env/server";
import { AwsClient } from "aws4fetch";

const client = new AwsClient({
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  region: env.S3_REGION,
  service: "s3",
});

export function createObjectKey(workspaceId: string, fileName: string) {
  const safeName = fileName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(-120);

  return `${workspaceId}/${crypto.randomUUID()}-${safeName || "file"}`;
}

export async function createUploadUrl(key: string, contentType: string) {
  const url = objectUrl(key);
  url.searchParams.set("X-Amz-Expires", String(15 * 60));

  const request = await client.sign(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    aws: { signQuery: true, allHeaders: true },
  });

  return request.url;
}

export async function createDownloadUrl(key: string) {
  const url = objectUrl(key);
  url.searchParams.set("X-Amz-Expires", String(15 * 60));

  const request = await client.sign(url, {
    method: "GET",
    aws: { signQuery: true },
  });

  return request.url;
}

export async function deleteObject(key: string) {
  const response = await client.fetch(objectUrl(key), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Object removal failed with status ${response.status}.`);
  }
}

function objectUrl(key: string) {
  const endpoint = env.S3_ENDPOINT.replace(/\/+$/, "");
  const bucket = encodeURIComponent(env.S3_BUCKET);
  const objectKey = key.split("/").map(encodeURIComponent).join("/");
  return new URL(`${endpoint}/${bucket}/${objectKey}`);
}
