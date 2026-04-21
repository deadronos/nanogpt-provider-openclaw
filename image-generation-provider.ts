import { NANOGPT_PROVIDER_ID } from "./models.js";
import { NANOGPT_IMAGE_GENERATION_TIMEOUT_MS, sanitizeApiKey } from "./runtime.js";
import type { ImageGenerationProvider } from "openclaw/plugin-sdk/image-generation";
import {
  resolveProviderHttpRequestConfig,
  postJsonRequest,
  assertOkOrThrowHttpError,
} from "openclaw/plugin-sdk/provider-http";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";
import { isProviderApiKeyConfigured } from "openclaw/plugin-sdk/provider-auth";

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
  const trimmed = model.trim();
  const withoutProviderPrefix = trimmed.replace(new RegExp(`^${NANOGPT_PROVIDER_ID}/`, "i"), "");
  const normalizedKey = withoutProviderPrefix.toLowerCase().replace(/[_\s]+/g, " ");
  return NANOGPT_IMAGE_MODEL_ALIASES.get(normalizedKey) ?? withoutProviderPrefix;
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
    id: NANOGPT_PROVIDER_ID,
    isConfigured: ({ agentDir }) => isProviderApiKeyConfigured({
      provider: NANOGPT_PROVIDER_ID,
      agentDir,
    }),
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
        provider: NANOGPT_PROVIDER_ID,
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
      if (size && !NANOGPT_IMAGE_SIZES.includes(size as any)) {
        throw new Error(`Invalid image size "${size}". Expected one of: ${NANOGPT_IMAGE_SIZES.join(", ")}`);
      }
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

      const { baseUrl, allowPrivateNetwork, headers, dispatcherPolicy } = resolveProviderHttpRequestConfig({
        baseUrl: NANOGPT_IMAGE_BASE_URL,
        defaultBaseUrl: NANOGPT_IMAGE_BASE_URL,
        allowPrivateNetwork: false,
        defaultHeaders: {
          Authorization: `Bearer ${sanitizeApiKey(auth.apiKey)}`,
          "Content-Type": "application/json",
        },
        provider: NANOGPT_PROVIDER_ID,
        capability: "image",
        transport: "http",
      });

      const { response, release } = await postJsonRequest({
        url: `${baseUrl}/v1/images/generations`,
        headers,
        body,
        timeoutMs: req.timeoutMs ?? NANOGPT_IMAGE_GENERATION_TIMEOUT_MS,
        fetchFn: fetch,
        allowPrivateNetwork,
        dispatcherPolicy,
      });

      try {
        // Surface curated model guidance when NanoGPT rejects an unknown model id
        const detail = (await response.clone().text()).trim();
        if (
          response.status === 400 &&
          /unknown model|invalid model|model/i.test(detail)
        ) {
          throw new Error(
            `${buildUnsupportedModelGuidance(requestedModel)} NanoGPT said: ${detail}`,
          );
        }

        await assertOkOrThrowHttpError(response, "NanoGPT image generation failed");
      } finally {
        await release();
      }

      const payload = (await response.json()) as NanoGptImageApiResponse;
      const images = (payload.data ?? [])
        .map((entry, index) => {
          if (!entry.b64_json) {
            return null;
          }
          return {
            buffer: Buffer.from(entry.b64_json, "base64"),
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
