import { NANOGPT_PROVIDER_ID } from "../models.js";

const NANOGPT_DEFAULT_IMAGE_MODEL = "hidream";
const NANOGPT_IMAGE_MODELS = [
  "hidream",
  "chroma",
  "z-image-turbo",
  "qwen-image-2512",
] as const;
const NANOGPT_IMAGE_SIZES = ["256x256", "512x512", "1024x1024"] as const;
const NANOGPT_IMAGE_MODEL_ALIASES = new Map<string, (typeof NANOGPT_IMAGE_MODELS)[number]>([
  ["hidream", "hidream"],
  ["hi dream", "hidream"],
  ["chroma", "chroma"],
  ["z-image-turbo", "z-image-turbo"],
  ["z image turbo", "z-image-turbo"],
  ["zimage turbo", "z-image-turbo"],
  ["qwen-image-2512", "qwen-image-2512"],
  ["qwen image 2512", "qwen-image-2512"],
  ["qwen-image", "qwen-image-2512"],
  ["qwen image", "qwen-image-2512"],
]);

function toDataUrl(buffer: Uint8Array, mimeType: string): string {
  if (typeof Buffer !== "undefined") {
    return `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
  }
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function normalizeImageModelName(model: string): string {
  const trimmed = model.trim();
  const withoutProviderPrefix = trimmed.replace(new RegExp(`^${NANOGPT_PROVIDER_ID}/`, "i"), "");
  const normalizedKey = withoutProviderPrefix.toLowerCase().replace(/[_\s]+/g, " ");
  return NANOGPT_IMAGE_MODEL_ALIASES.get(normalizedKey) ?? withoutProviderPrefix;
}

function validateNanoGptImageSize(size: string): void {
  if (!(NANOGPT_IMAGE_SIZES as readonly string[]).includes(size)) {
    throw new Error(`Invalid image size "${size}". Expected one of: ${NANOGPT_IMAGE_SIZES.join(", ")}`);
  }
}

export {
  NANOGPT_DEFAULT_IMAGE_MODEL,
  NANOGPT_IMAGE_MODELS,
  NANOGPT_IMAGE_SIZES,
  normalizeImageModelName,
  toDataUrl,
  validateNanoGptImageSize,
};
