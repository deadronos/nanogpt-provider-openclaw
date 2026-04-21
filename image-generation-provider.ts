import { NANOGPT_PROVIDER_ID } from "./models.js";
import { NANOGPT_IMAGE_GENERATION_TIMEOUT_MS } from "./runtime.js";
import { sanitizeApiKey } from "./shared/http.js";
import {
  NANOGPT_DEFAULT_IMAGE_MODEL,
  NANOGPT_IMAGE_MODELS,
  NANOGPT_IMAGE_SIZES,
  normalizeImageModelName,
  toDataUrl,
  validateNanoGptImageSize,
} from "./image/request.js";
import {
  buildUnsupportedModelGuidance,
  parseNanoGptImageResponse,
} from "./image/response.js";
import type { ImageGenerationProvider } from "openclaw/plugin-sdk/image-generation";
import {
  resolveProviderHttpRequestConfig,
  postJsonRequest,
  assertOkOrThrowHttpError,
} from "openclaw/plugin-sdk/provider-http";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";
import { isProviderApiKeyConfigured } from "openclaw/plugin-sdk/provider-auth";

const NANOGPT_IMAGE_BASE_URL = "https://nano-gpt.com";

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
      if (size) {
        validateNanoGptImageSize(size);
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

      let parsedPayload: ReturnType<typeof parseNanoGptImageResponse> | undefined;
      try {
        if (!response.ok) {
          const detail = (await response.clone().text()).trim();
          if (
            response.status === 400 &&
            /unknown model|invalid model|model/i.test(detail)
          ) {
            throw new Error(
              `${buildUnsupportedModelGuidance(requestedModel)} NanoGPT said: ${detail}`,
            );
          }
        }

        await assertOkOrThrowHttpError(response, "NanoGPT image generation failed");
        parsedPayload = parseNanoGptImageResponse((await response.json()) as never);
      } finally {
        await release();
      }

      return {
        images: parsedPayload!.images,
        model,
      };
    },
  };
}
