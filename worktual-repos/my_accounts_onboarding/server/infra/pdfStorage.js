import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env, isProduction } from "./env.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const localPdfDir = path.join(projectRoot, "server", "data", "pdfs");

function useS3() {
  return Boolean(env("S3_BUCKET") && env("AWS_ACCESS_KEY_ID") && env("AWS_SECRET_ACCESS_KEY"));
}

async function ensureLocalDir() {
  await fs.mkdir(localPdfDir, { recursive: true });
}

export async function storePdf({ quotationId, fileName, base64 }) {
  if (!base64) {
    return { storage: "inline", path: null };
  }

  if (useS3()) {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: env("AWS_REGION") || "us-east-1",
      credentials: {
        accessKeyId: env("AWS_ACCESS_KEY_ID"),
        secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
      },
    });

    const key = `quotations/${quotationId}/${fileName || "invoice.pdf"}`;
    await client.send(
      new PutObjectCommand({
        Bucket: env("S3_BUCKET"),
        Key: key,
        Body: Buffer.from(base64, "base64"),
        ContentType: "application/pdf",
      }),
    );

    return { storage: "s3", path: key };
  }

  await ensureLocalDir();
  const safeName = (fileName || `${quotationId}.pdf`).replace(/[^\w.-]+/g, "_");
  const filePath = path.join(localPdfDir, safeName);
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));

  if (isProduction()) {
    console.warn("[pdf] Stored PDF on local disk — configure S3_BUCKET for production.");
  }

  return { storage: "local", path: filePath };
}

export async function loadPdf(stored) {
  if (!stored?.path) {
    return null;
  }

  if (stored.storage === "s3") {
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: env("AWS_REGION") || "us-east-1",
      credentials: {
        accessKeyId: env("AWS_ACCESS_KEY_ID"),
        secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
      },
    });

    const result = await client.send(
      new GetObjectCommand({
        Bucket: env("S3_BUCKET"),
        Key: stored.path,
      }),
    );

    const chunks = [];
    for await (const chunk of result.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("base64");
  }

  if (stored.storage === "local") {
    const buffer = await fs.readFile(stored.path);
    return buffer.toString("base64");
  }

  return null;
}
