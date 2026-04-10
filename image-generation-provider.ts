import type { ImageGenerationProvider } from "openclaw/plugin-sdk/image-generation";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";

const NANOGPT_IMAGE_BASE_URL = "https://nano-gpt.com";
const NANOGPT_DEFAULT_IMAGE_MODEL = "hidream";
const NANOGPT_DEFAULT_OUTPUT_MIME = "image/png";
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
  const normalizedKey = model.trim().toLowerCase().replace(/[_\s]+/g, " ");
  return NANOGPT_IMAGE_MODEL_ALIASES.get(normalizedKey) ?? model.trim();
}

function buildUnsupportedModelGuidance(model: string): string {
  return [
    `NanoGPT image generation failed for model "${model}".`,
    `Try one of: ${NANOGPT_IMAGE_MODELS.join(", ")}.`,
    `Accepted aliases include: "HIDREAM", "CHROMA", "Z IMAGE TURBO", and "QWEN IMAGE".`,
  ].join(" ");
}

export function buildNanoGptImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: "nanogpt",
    label: "NanoGPT",
    defaultModel: NANOGPT_DEFAULT_IMAGE_MODEL,
    models: [...NANOGPT_IMAGE_MODELS],
    capabilities: {
      generate: {
        maxCount: 4,
        supportsSize: true,
        supportsAspectRatio: false,
        supportsResolution: false,
      },
      edit: {
        enabled: true,
        maxCount: 4,
        maxInputImages: 4,
        supportsSize: true,
        supportsAspectRatio: false,
        supportsResolution: false,
      },
      geometry: {
        sizes: [...NANOGPT_IMAGE_SIZES],
      },
    },
    async generateImage(req) {
      const auth = await resolveApiKeyForProvider({
        provider: "nanogpt",
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error("NanoGPT API key missing");
      }

      const requestedModel = req.model || NANOGPT_DEFAULT_IMAGE_MODEL;
      const model = normalizeImageModelName(requestedModel);
      const count = req.count ?? 1;
      const size = req.size ?? "1024x1024";
      const inputImages = req.inputImages ?? [];
      const body: Record<string, unknown> = {
        model,
        prompt: req.prompt,
        n: count,
        response_format: "b64_json",
      };

      if (size) {
        body.size = size;
      }

      if (inputImages.length === 1) {
        const image = inputImages[0];
        const mimeType = image?.mimeType?.trim() || "image/png";
        body.imageDataUrl = toDataUrl(image.buffer, mimeType);
      } else if (inputImages.length > 1) {
        body.imageDataUrls = inputImages.map((image) =>
          toDataUrl(image.buffer, image.mimeType?.trim() || "image/png"),
        );
      }

      const response = await fetch(`${NANOGPT_IMAGE_BASE_URL}/v1/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const detail = await response.text();
        const detailMessage = detail.trim();
        if (
          response.status === 400 &&
          /unknown model|invalid model|model/i.test(detailMessage)
        ) {
          throw new Error(
            `${buildUnsupportedModelGuidance(requestedModel)} NanoGPT said: ${detailMessage}`,
          );
        }
        throw new Error(`NanoGPT image generation failed (${response.status}): ${detail}`);
      }

      const payload = (await response.json()) as NanoGptImageApiResponse;
      const images = (payload.data ?? [])
        .map((entry, index) => {
          if (!entry.b64_json) {
            return null;
          }
          return {
            buffer: typeof Buffer !== "undefined"
              ? Buffer.from(entry.b64_json, "base64")
              : Uint8Array.from(atob(entry.b64_json), (c) => c.charCodeAt(0)),
            mimeType: NANOGPT_DEFAULT_OUTPUT_MIME,
            fileName: `image-${index + 1}.${inferFileExtensionFromMimeType(
              NANOGPT_DEFAULT_OUTPUT_MIME,
            )}`,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      return {
        images,
        model,
      };
    },
  };
}
