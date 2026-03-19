import { createHash } from "node:crypto";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
const apiKey = process.env.CLOUDINARY_API_KEY || "";
const apiSecret = process.env.CLOUDINARY_API_SECRET || "";
const uploadFolder = process.env.CLOUDINARY_UPLOAD_FOLDER || "attendanceiq";

function ensureConfigured() {
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary is not configured");
  }
}

function signParams(params: Record<string, string | number>) {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && `${value}`.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  const toSign = entries
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return createHash("sha1")
    .update(`${toSign}${apiSecret}`)
    .digest("hex");
}

export function createCloudinarySignedUpload(input: {
  resourceType?: "image" | "raw" | "video" | "auto";
  publicId: string;
  folder?: string;
}) {
  ensureConfigured();

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = input.folder || uploadFolder;
  const resourceType = input.resourceType || "raw";

  const signature = signParams({
    folder,
    public_id: input.publicId,
    timestamp,
  });

  return {
    cloudName,
    apiKey,
    timestamp,
    folder,
    publicId: input.publicId,
    signature,
    resourceType,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
  };
}

export async function uploadCloudinaryAsset(input: {
  buffer: Buffer | Uint8Array | ArrayBuffer;
  publicId: string;
  folder?: string;
  fileName?: string;
  contentType?: string;
  resourceType?: "image" | "raw" | "video" | "auto";
}) {
  ensureConfigured();

  const folder = input.folder || uploadFolder;
  const resourceType = input.resourceType || "image";
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({
    folder,
    public_id: input.publicId,
    timestamp,
  });

  const body = new FormData();
  const bufferView =
    input.buffer instanceof Uint8Array ? input.buffer : new Uint8Array(input.buffer);
  const arrayBuffer = bufferView.buffer.slice(
    bufferView.byteOffset,
    bufferView.byteOffset + bufferView.byteLength
  ) as ArrayBuffer;
  body.set(
    "file",
    new Blob([arrayBuffer], {
      type: input.contentType || "application/octet-stream",
    }),
    input.fileName || `${input.publicId}.bin`
  );
  body.set("folder", folder);
  body.set("public_id", input.publicId);
  body.set("timestamp", `${timestamp}`);
  body.set("api_key", apiKey);
  body.set("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    {
      method: "POST",
      body,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloudinary upload failed: ${text || response.statusText}`);
  }

  const payload = (await response.json()) as {
    secure_url?: string;
    public_id?: string;
    resource_type?: string;
  };

  if (!payload.secure_url || !payload.public_id) {
    throw new Error("Cloudinary upload did not return an asset URL");
  }

  return {
    secureUrl: payload.secure_url,
    publicId: payload.public_id,
    resourceType: payload.resource_type ?? resourceType,
  };
}

export async function destroyCloudinaryAsset(input: {
  publicId: string;
  resourceType?: "image" | "raw" | "video";
}): Promise<boolean> {
  ensureConfigured();

  const resourceType = input.resourceType || "raw";
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({
    public_id: input.publicId,
    timestamp,
  });

  const formData = new URLSearchParams();
  formData.set("public_id", input.publicId);
  formData.set("timestamp", `${timestamp}`);
  formData.set("api_key", apiKey);
  formData.set("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    }
  );

  if (!response.ok) {
    return false;
  }

  const body = (await response.json()) as { result?: string };
  return body.result === "ok" || body.result === "not found";
}
