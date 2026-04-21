const NANOGPT_DEFAULT_OUTPUT_MIME = "image/png";

type NanoGptImageApiResponse = {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
};

function inferFileExtensionFromMimeType(mimeType: string): string {
  if (mimeType.includes("jpeg")) {
    return "jpg";
  }
  if (mimeType.includes("webp")) {
    return "webp";
  }
  return "png";
}

function buildUnsupportedModelGuidance(model: string): string {
  return [
    `NanoGPT image generation failed for model "${model}".`,
    `Try one of: hidream, chroma, z-image-turbo, qwen-image-2512.`,
    `Accepted aliases include: "HIDREAM", "CHROMA", "Z IMAGE TURBO", and "QWEN IMAGE".`,
  ].join(" ");
}

function parseNanoGptImageResponse(payload: NanoGptImageApiResponse): {
  images: Array<{
    buffer: Buffer;
    mimeType: string;
    fileName: string;
  }>;
} {
  const images = (payload.data ?? [])
    .map((entry, index) => {
      if (!entry.b64_json) {
        return null;
      }
      return {
        buffer: Buffer.from(entry.b64_json, "base64"),
        mimeType: NANOGPT_DEFAULT_OUTPUT_MIME,
        fileName: `image-${index + 1}.${inferFileExtensionFromMimeType(NANOGPT_DEFAULT_OUTPUT_MIME)}`,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return { images };
}

export type { NanoGptImageApiResponse };
export {
  NANOGPT_DEFAULT_OUTPUT_MIME,
  buildUnsupportedModelGuidance,
  inferFileExtensionFromMimeType,
  parseNanoGptImageResponse,
};
