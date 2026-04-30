# NanoGPT Provider Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Create a publishable external native OpenClaw plugin in
`nanogpt-provider-openclaw` that registers a `nanogpt` provider with:

- API-key auth via `NANOGPT_API_KEY`
- OpenAI-compatible transport
- dynamic NanoGPT model discovery
- `routingMode: auto | subscription | paygo`
- `catalogSource: auto | canonical | subscription | paid | personalized`
- optional per-request upstream provider selection
- graceful fallback to a small static model catalog

## File Map

- `package.json`
  - Package metadata, scripts, OpenClaw metadata, and dev dependencies
- `tsconfig.json`
  - TypeScript configuration for ESM plugin development
- `openclaw.plugin.json`
  - Plugin manifest, auth metadata, and config schema
- `index.ts`
  - Main plugin registration entrypoint
- `api.ts`
  - Curated local export surface
- `models.ts`
  - NanoGPT endpoint constants, fallback models, response types, and model parsing
- `runtime.ts`
  - Subscription probing cache, routing resolution, discovery fetch, and request decoration helpers
- `provider-catalog.ts`
  - Build provider config and catalog result from NanoGPT state
- `onboard.ts`
  - Default model aliasing and apply-config helpers
- `index.test.ts`
  - Provider registration behavior tests
- `runtime.test.ts`
  - Routing, subscription probe, discovery, and request decoration tests
- `provider-catalog.test.ts`
  - Catalog construction and fallback tests
- `README.md`
  - Install, configure, and use instructions

## Implementation Tasks

- [ ] **Step 1: Create the package manifest**

Create `package.json` with the initial package metadata and scripts:

```json
{
  "name": "@deadronos/openclaw-nanogpt-provider",
  "version": "0.1.0",
  "description": "OpenClaw NanoGPT provider plugin",
  "type": "module",
  "license": "MIT",
  "files": [
    "index.ts",
    "api.ts",
    "models.ts",
    "runtime.ts",
    "provider-catalog.ts",
    "onboard.ts",
    "openclaw.plugin.json",
    "README.md"
  ],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "openclaw": ">=2026.3.24-beta.2"
  },
  "devDependencies": {
    "openclaw": "^2026.4.5",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4",
    "@types/node": "^24.6.0"
  },
  "openclaw": {
    "extensions": ["./index.ts"],
    "providers": ["nanogpt"],
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2",
      "minGatewayVersion": "2026.3.24-beta.2"
    },
    "build": {
      "openclawVersion": "2026.4.5",
      "pluginSdkVersion": "2026.4.5"
    }
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 3: Install dependencies**

Run:

```bash
npm install
```

Expected:

- `package-lock.json` is created
- `node_modules/` is populated

- [ ] **Step 4: Create the plugin manifest**

Create `openclaw.plugin.json`:

```json
{
  "id": "nanogpt",
  "name": "NanoGPT",
  "description": "NanoGPT provider plugin for OpenClaw",
  "providers": ["nanogpt"],
  "providerAuthEnvVars": {
    "nanogpt": ["NANOGPT_API_KEY"]
  },
  "providerAuthChoices": [
    {
      "provider": "nanogpt",
      "method": "api-key",
      "choiceId": "nanogpt-api-key",
      "choiceLabel": "NanoGPT API key",
      "groupId": "nanogpt",
      "groupLabel": "NanoGPT",
      "groupHint": "Subscription or pay-as-you-go",
      "optionKey": "nanogptApiKey",
      "cliFlag": "--nanogpt-api-key",
      "cliOption": "--nanogpt-api-key <key>",
      "cliDescription": "NanoGPT API key"
    }
  ],
  "uiHints": {
    "routingMode": {
      "label": "Routing Mode",
      "help": "Choose auto, subscription, or paygo routing."
    },
    "catalogSource": {
      "label": "Catalog Source",
      "help": "Choose how NanoGPT model discovery should work."
    },
    "provider": {
      "label": "Provider Override",
      "help": "Optional NanoGPT upstream provider id for paygo provider selection."
    }
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "routingMode": {
        "type": "string",
        "enum": ["auto", "subscription", "paygo"]
      },
      "catalogSource": {
        "type": "string",
        "enum": ["auto", "canonical", "subscription", "paid", "personalized"]
      },
      "provider": {
        "type": "string"
      }
    }
  }
}
```

- [ ] **Step 5: Write the first manifest-focused test**

Create `index.test.ts` with the first failing test:

```ts
import { describe, expect, it } from "vitest";
import { registerSingleProviderPlugin } from "openclaw/test/helpers/plugins/plugin-registration.js";
import nanogptPlugin from "./index.js";

describe("nanogpt provider registration", () => {
  it("registers the nanogpt provider", async () => {
    const provider = await registerSingleProviderPlugin(nanogptPlugin);

    expect(provider.id).toBe("nanogpt");
    expect(provider.label).toBe("NanoGPT");
    expect(provider.docsPath).toBe("/providers/models");
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run:

```bash
npm test -- index.test.ts
```

Expected:

- FAIL because `index.ts` does not exist yet

- [ ] **Step 7: Create model constants and fallback catalog**

Create `models.ts`:

```ts
import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";

export const NANOGPT_PROVIDER_ID = "nanogpt";
export const NANOGPT_BASE_URL = "https://nano-gpt.com/api/v1";
export const NANOGPT_SUBSCRIPTION_BASE_URL = "https://nano-gpt.com/api/subscription/v1";
export const NANOGPT_PAID_BASE_URL = "https://nano-gpt.com/api/paid/v1";
export const NANOGPT_PERSONALIZED_BASE_URL = "https://nano-gpt.com/api/personalized/v1";
export const NANOGPT_DEFAULT_MODEL_ID = "gpt-5.4-mini";
export const NANOGPT_DEFAULT_MODEL_REF = `${NANOGPT_PROVIDER_ID}/${NANOGPT_DEFAULT_MODEL_ID}`;

export const NANOGPT_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

export const NANOGPT_FALLBACK_MODELS: ModelDefinitionConfig[] = [
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    reasoning: true,
    input: ["text", "image"],
    cost: NANOGPT_DEFAULT_COST,
    contextWindow: 200000,
    maxTokens: 32768,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    reasoning: true,
    input: ["text", "image"],
    cost: NANOGPT_DEFAULT_COST,
    contextWindow: 200000,
    maxTokens: 32768,
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    reasoning: true,
    input: ["text", "image"],
    cost: NANOGPT_DEFAULT_COST,
    contextWindow: 200000,
    maxTokens: 32768,
  },
];

export type NanoGptRoutingMode = "auto" | "subscription" | "paygo";
export type NanoGptCatalogSource = "auto" | "canonical" | "subscription" | "paid" | "personalized";

export interface NanoGptPluginConfig {
  routingMode?: NanoGptRoutingMode;
  catalogSource?: NanoGptCatalogSource;
  provider?: string;
}

export interface NanoGptModelEntry {
  id?: string;
  canonicalId?: string;
  name?: string;
  displayName?: string;
  reasoning?: boolean;
  vision?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  pricing?: {
    inputPer1kTokens?: number;
    outputPer1kTokens?: number;
  };
}

function toPerMillion(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value * 1000;
}

export function buildNanoGptModelDefinition(
  entry: NanoGptModelEntry,
): ModelDefinitionConfig | null {
  const id = String(entry.canonicalId ?? entry.id ?? "").trim();
  if (!id) {
    return null;
  }

  return {
    id,
    name: String(entry.displayName ?? entry.name ?? id),
    reasoning: Boolean(entry.reasoning),
    input: entry.vision ? ["text", "image"] : ["text"],
    cost: {
      input: toPerMillion(entry.pricing?.inputPer1kTokens),
      output: toPerMillion(entry.pricing?.outputPer1kTokens),
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow:
      typeof entry.contextWindow === "number" && entry.contextWindow > 0
        ? entry.contextWindow
        : 200000,
    maxTokens: typeof entry.maxTokens === "number" && entry.maxTokens > 0 ? entry.maxTokens : 32768,
  };
}
```

- [ ] **Step 8: Add runtime tests for routing and discovery helpers**

Create `runtime.test.ts` with a first red test:

```ts
import { describe, expect, it } from "vitest";
import { resolveNanoGptRoutingMode } from "./runtime.js";

describe("resolveNanoGptRoutingMode", () => {
  it("returns explicit paygo without probing", async () => {
    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "paygo" },
        apiKey: "test-key",
      }),
    ).resolves.toBe("paygo");
  });
});
```

- [ ] **Step 9: Run the tests to verify they fail**

Run:

```bash
npm test -- index.test.ts runtime.test.ts
```

Expected:

- FAIL because `runtime.ts` and `index.ts` do not exist yet

- [ ] **Step 10: Implement runtime helpers**

Create `runtime.ts`:

```ts
import { createSubsystemLogger } from "openclaw/plugin-sdk/runtime-env";
import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  NANOGPT_BASE_URL,
  NANOGPT_FALLBACK_MODELS,
  NANOGPT_PAID_BASE_URL,
  NANOGPT_PERSONALIZED_BASE_URL,
  NANOGPT_SUBSCRIPTION_BASE_URL,
  buildNanoGptModelDefinition,
  type NanoGptCatalogSource,
  type NanoGptModelEntry,
  type NanoGptPluginConfig,
  type NanoGptRoutingMode,
} from "./models.js";

const log = createSubsystemLogger("nanogpt-runtime");
const SUBSCRIPTION_CACHE_TTL_MS = 60_000;

let cachedSubscription: { expiresAt: number; active: boolean } | null = null;

function trimProvider(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getNanoGptConfig(config: unknown): NanoGptPluginConfig {
  if (!config || typeof config !== "object") {
    return {};
  }
  const candidate = config as Record<string, unknown>;
  return {
    routingMode:
      candidate.routingMode === "auto" ||
      candidate.routingMode === "subscription" ||
      candidate.routingMode === "paygo"
        ? candidate.routingMode
        : undefined,
    catalogSource:
      candidate.catalogSource === "auto" ||
      candidate.catalogSource === "canonical" ||
      candidate.catalogSource === "subscription" ||
      candidate.catalogSource === "paid" ||
      candidate.catalogSource === "personalized"
        ? candidate.catalogSource
        : undefined,
    provider: typeof candidate.provider === "string" ? trimProvider(candidate.provider) : undefined,
  };
}

export async function probeNanoGptSubscription(apiKey: string): Promise<boolean> {
  const now = Date.now();
  if (cachedSubscription && cachedSubscription.expiresAt > now) {
    return cachedSubscription.active;
  }

  const response = await fetch(`${NANOGPT_SUBSCRIPTION_BASE_URL}/usage`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`NanoGPT subscription probe failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as { subscribed?: boolean; active?: boolean };
  const active = Boolean(data.subscribed ?? data.active);
  cachedSubscription = { active, expiresAt: now + SUBSCRIPTION_CACHE_TTL_MS };
  return active;
}

export async function resolveNanoGptRoutingMode(params: {
  config: NanoGptPluginConfig;
  apiKey: string;
}): Promise<Exclude<NanoGptRoutingMode, "auto">> {
  const mode = params.config.routingMode ?? "auto";
  if (mode === "subscription" || mode === "paygo") {
    return mode;
  }

  try {
    return (await probeNanoGptSubscription(params.apiKey)) ? "subscription" : "paygo";
  } catch (error) {
    log.warn(`Subscription probe failed: ${String(error)}`);
    return "paygo";
  }
}

export function resolveCatalogSource(params: {
  config: NanoGptPluginConfig;
  routingMode: "subscription" | "paygo";
}): Exclude<NanoGptCatalogSource, "auto"> {
  const source = params.config.catalogSource ?? "auto";
  if (source !== "auto") {
    return source;
  }
  return params.routingMode === "subscription" ? "subscription" : "canonical";
}

export function resolveCatalogBaseUrl(source: Exclude<NanoGptCatalogSource, "auto">): string {
  switch (source) {
    case "subscription":
      return NANOGPT_SUBSCRIPTION_BASE_URL;
    case "paid":
      return NANOGPT_PAID_BASE_URL;
    case "personalized":
      return NANOGPT_PERSONALIZED_BASE_URL;
    case "canonical":
    default:
      return NANOGPT_BASE_URL;
  }
}

export function resolveRequestBaseUrl(routingMode: "subscription" | "paygo"): string {
  return routingMode === "subscription" ? NANOGPT_SUBSCRIPTION_BASE_URL : NANOGPT_BASE_URL;
}

export async function discoverNanoGptModels(params: {
  apiKey: string;
  source: Exclude<NanoGptCatalogSource, "auto">;
}): Promise<ModelDefinitionConfig[]> {
  try {
    const response = await fetch(`${resolveCatalogBaseUrl(params.source)}/models`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
    });

    if (!response.ok) {
      log.warn(`NanoGPT model discovery failed with HTTP ${response.status}`);
      return NANOGPT_FALLBACK_MODELS;
    }

    const data = (await response.json()) as { data?: NanoGptModelEntry[] } | NanoGptModelEntry[];
    const entries = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : [];
    const models = entries
      .map((entry) => buildNanoGptModelDefinition(entry))
      .filter((entry): entry is ModelDefinitionConfig => entry !== null);

    return models.length > 0 ? models : NANOGPT_FALLBACK_MODELS;
  } catch (error) {
    log.warn(`NanoGPT model discovery failed: ${String(error)}`);
    return NANOGPT_FALLBACK_MODELS;
  }
}

export function buildNanoGptRequestHeaders(params: {
  apiKey: string;
  config: NanoGptPluginConfig;
  routingMode: "subscription" | "paygo";
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
  };

  if (params.config.provider) {
    headers["X-Provider"] = params.config.provider;
    if (params.routingMode === "subscription") {
      headers["X-Billing-Mode"] = "paygo";
    }
  }

  return headers;
}

export function resetNanoGptRuntimeState(): void {
  cachedSubscription = null;
}
```

- [ ] **Step 11: Implement onboarding helpers**

Create `onboard.ts`:

```ts
import {
  applyAgentDefaultModelPrimary,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/provider-onboard";
import { NANOGPT_DEFAULT_MODEL_REF } from "./models.js";

export function applyNanoGptProviderConfig(cfg: OpenClawConfig): OpenClawConfig {
  const models = { ...cfg.agents?.defaults?.models };
  models[NANOGPT_DEFAULT_MODEL_REF] = {
    ...models[NANOGPT_DEFAULT_MODEL_REF],
    alias: models[NANOGPT_DEFAULT_MODEL_REF]?.alias ?? "NanoGPT",
  };

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models,
      },
    },
  };
}

export function applyNanoGptConfig(cfg: OpenClawConfig): OpenClawConfig {
  return applyAgentDefaultModelPrimary(applyNanoGptProviderConfig(cfg), NANOGPT_DEFAULT_MODEL_REF);
}
```

- [ ] **Step 12: Implement provider catalog builder**

Create `provider-catalog.ts`:

```ts
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  NANOGPT_PROVIDER_ID,
  getNanoGptConfig,
  resolveNanoGptRoutingMode,
  resolveCatalogSource,
  resolveRequestBaseUrl,
  discoverNanoGptModels,
} from "./runtime.js";

export async function buildNanoGptProvider(params: {
  apiKey: string;
  pluginConfig: unknown;
}): Promise<ModelProviderConfig> {
  const config = getNanoGptConfig(params.pluginConfig);
  const routingMode = await resolveNanoGptRoutingMode({
    config,
    apiKey: params.apiKey,
  });
  const source = resolveCatalogSource({ config, routingMode });
  const models = await discoverNanoGptModels({
    apiKey: params.apiKey,
    source,
  });

  return {
    baseUrl: resolveRequestBaseUrl(routingMode),
    api: "openai-completions",
    models: models.map((model) => ({
      ...model,
      provider: NANOGPT_PROVIDER_ID,
      headers: undefined,
    })),
  };
}
```

- [ ] **Step 13: Implement the plugin entrypoint**

Create `index.ts`:

```ts
import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import { applyNanoGptConfig } from "./onboard.js";
import { NANOGPT_DEFAULT_MODEL_REF, NANOGPT_PROVIDER_ID } from "./models.js";
import { buildNanoGptProvider } from "./provider-catalog.js";

export default defineSingleProviderPluginEntry({
  id: NANOGPT_PROVIDER_ID,
  name: "NanoGPT Provider",
  description: "NanoGPT provider plugin for OpenClaw",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      routingMode: {
        type: "string",
        enum: ["auto", "subscription", "paygo"],
      },
      catalogSource: {
        type: "string",
        enum: ["auto", "canonical", "subscription", "paid", "personalized"],
      },
      provider: {
        type: "string",
      },
    },
  },
  provider: {
    label: "NanoGPT",
    docsPath: "/providers/models",
    envVars: ["NANOGPT_API_KEY"],
    auth: [
      {
        methodId: "api-key",
        label: "NanoGPT API key",
        hint: "Subscription or pay-as-you-go",
        optionKey: "nanogptApiKey",
        flagName: "--nanogpt-api-key",
        envVar: "NANOGPT_API_KEY",
        promptMessage: "Enter NanoGPT API key",
        defaultModel: NANOGPT_DEFAULT_MODEL_REF,
        applyConfig: (cfg) => applyNanoGptConfig(cfg),
        wizard: {
          choiceId: "nanogpt-api-key",
          choiceLabel: "NanoGPT API key",
          groupId: "nanogpt",
          groupLabel: "NanoGPT",
          groupHint: "Subscription or pay-as-you-go",
        },
      },
    ],
    catalog: {
      buildProvider: () => {
        throw new Error("buildProvider is not used directly for NanoGPT");
      },
    },
    async catalog(ctx) {
      const apiKey = ctx.resolveProviderApiKey(NANOGPT_PROVIDER_ID).apiKey;
      if (!apiKey) {
        return null;
      }
      return {
        provider: await buildNanoGptProvider({
          apiKey,
          pluginConfig: ctx.pluginConfig,
        }),
      };
    },
  },
});
```

- [ ] **Step 14: Fix the entrypoint to use `definePluginEntry` if the `catalog` override above does not type-check**

If `defineSingleProviderPluginEntry` is too narrow for NanoGPT's async runtime-dependent catalog,
replace `index.ts` with:

```ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import { applyNanoGptConfig } from "./onboard.js";
import { NANOGPT_DEFAULT_MODEL_REF, NANOGPT_PROVIDER_ID } from "./models.js";
import { buildNanoGptProvider } from "./provider-catalog.js";

export default definePluginEntry({
  id: NANOGPT_PROVIDER_ID,
  name: "NanoGPT Provider",
  description: "NanoGPT provider plugin for OpenClaw",
  register(api) {
    api.registerProvider({
      id: NANOGPT_PROVIDER_ID,
      label: "NanoGPT",
      docsPath: "/providers/models",
      envVars: ["NANOGPT_API_KEY"],
      auth: [
        createProviderApiKeyAuthMethod({
          providerId: NANOGPT_PROVIDER_ID,
          methodId: "api-key",
          label: "NanoGPT API key",
          hint: "Subscription or pay-as-you-go",
          optionKey: "nanogptApiKey",
          flagName: "--nanogpt-api-key",
          envVar: "NANOGPT_API_KEY",
          promptMessage: "Enter NanoGPT API key",
          defaultModel: NANOGPT_DEFAULT_MODEL_REF,
          expectedProviders: [NANOGPT_PROVIDER_ID],
          applyConfig: (cfg) => applyNanoGptConfig(cfg),
          wizard: {
            choiceId: "nanogpt-api-key",
            choiceLabel: "NanoGPT API key",
            groupId: "nanogpt",
            groupLabel: "NanoGPT",
            groupHint: "Subscription or pay-as-you-go",
          },
        }),
      ],
      catalog: {
        order: "simple",
        run: async (ctx) => {
          const apiKey = ctx.resolveProviderApiKey(NANOGPT_PROVIDER_ID).apiKey;
          if (!apiKey) {
            return null;
          }
          return {
            provider: await buildNanoGptProvider({
              apiKey,
              pluginConfig: ctx.pluginConfig,
            }),
          };
        },
      },
    });
  },
});
```

- [ ] **Step 15: Create the local API barrel**

Create `api.ts`:

```ts
export {
  NANOGPT_BASE_URL,
  NANOGPT_DEFAULT_MODEL_ID,
  NANOGPT_DEFAULT_MODEL_REF,
  NANOGPT_FALLBACK_MODELS,
  NANOGPT_PAID_BASE_URL,
  NANOGPT_PERSONALIZED_BASE_URL,
  NANOGPT_PROVIDER_ID,
  NANOGPT_SUBSCRIPTION_BASE_URL,
  buildNanoGptModelDefinition,
} from "./models.js";
export { applyNanoGptConfig, applyNanoGptProviderConfig } from "./onboard.js";
export { buildNanoGptProvider } from "./provider-catalog.js";
export {
  buildNanoGptRequestHeaders,
  discoverNanoGptModels,
  getNanoGptConfig,
  probeNanoGptSubscription,
  resetNanoGptRuntimeState,
  resolveCatalogBaseUrl,
  resolveCatalogSource,
  resolveNanoGptRoutingMode,
  resolveRequestBaseUrl,
} from "./runtime.js";
```

- [ ] **Step 16: Run the tests to verify they now pass or fail for the right reasons**

Run:

```bash
npm test -- index.test.ts runtime.test.ts
```

Expected:

- Either PASS, or FAIL with specific assertion/type mismatches rather than missing files

- [ ] **Step 17: Add deeper runtime behavior tests**

Expand `runtime.test.ts` to cover:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNanoGptRequestHeaders,
  discoverNanoGptModels,
  resetNanoGptRuntimeState,
  resolveCatalogSource,
  resolveNanoGptRoutingMode,
} from "./runtime.js";

afterEach(() => {
  resetNanoGptRuntimeState();
  vi.restoreAllMocks();
});

describe("runtime helpers", () => {
  it("resolves auto to subscription when the probe says subscribed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ subscribed: true }),
      })),
    );

    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "auto" },
        apiKey: "test-key",
      }),
    ).resolves.toBe("subscription");
  });

  it("falls back to paygo when the subscription probe fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );

    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "auto" },
        apiKey: "test-key",
      }),
    ).resolves.toBe("paygo");
  });

  it("maps auto catalog source from routing mode", () => {
    expect(resolveCatalogSource({ config: {}, routingMode: "subscription" })).toBe("subscription");
    expect(resolveCatalogSource({ config: {}, routingMode: "paygo" })).toBe("canonical");
  });

  it("adds paygo billing override when provider selection is used on subscription routing", () => {
    expect(
      buildNanoGptRequestHeaders({
        apiKey: "test-key",
        config: { provider: "openrouter" },
        routingMode: "subscription",
      }),
    ).toMatchObject({
      Authorization: "Bearer test-key",
      "X-Provider": "openrouter",
      "X-Billing-Mode": "paygo",
    });
  });

  it("falls back to static models when discovery fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 })),
    );

    const models = await discoverNanoGptModels({
      apiKey: "test-key",
      source: "canonical",
    });

    expect(models.length).toBeGreaterThan(0);
    expect(models[0]?.id).toBeTruthy();
  });
});
```

- [ ] **Step 18: Add provider catalog tests**

Create `provider-catalog.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNanoGptProvider } from "./provider-catalog.js";
import { resetNanoGptRuntimeState } from "./runtime.js";

afterEach(() => {
  resetNanoGptRuntimeState();
  vi.restoreAllMocks();
});

describe("buildNanoGptProvider", () => {
  it("uses the subscription base URL when auto resolves to subscription", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ subscribed: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", reasoning: true }],
          }),
        }),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: { routingMode: "auto", catalogSource: "auto" },
    });

    expect(provider.baseUrl).toContain("/api/subscription/v1");
    expect(provider.models[0]?.id).toBe("gpt-5.4-mini");
  });

  it("uses the canonical base URL when paygo is pinned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }] }),
      })),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: { routingMode: "paygo", catalogSource: "canonical" },
    });

    expect(provider.baseUrl).toContain("/api/v1");
  });
});
```

- [ ] **Step 19: Add or refine registration tests**

Expand `index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { registerSingleProviderPlugin } from "openclaw/test/helpers/plugins/plugin-registration.js";
import nanogptPlugin from "./index.js";

describe("nanogpt provider registration", () => {
  it("registers the nanogpt provider", async () => {
    const provider = await registerSingleProviderPlugin(nanogptPlugin);

    expect(provider.id).toBe("nanogpt");
    expect(provider.label).toBe("NanoGPT");
    expect(provider.docsPath).toBe("/providers/models");
  });

  it("registers API-key auth", async () => {
    const provider = await registerSingleProviderPlugin(nanogptPlugin);

    expect(provider.auth).toHaveLength(1);
    expect(provider.auth[0]?.id).toContain("api-key");
  });
});
```

- [ ] **Step 20: Run the focused test suite**

Run:

```bash
npm test -- index.test.ts runtime.test.ts provider-catalog.test.ts
```

Expected:

- PASS

- [ ] **Step 21: Run typechecking**

Run:

```bash
npm run typecheck
```

Expected:

- PASS

- [ ] **Step 22: Write the README**

Create `README.md`:

````md
# NanoGPT Provider for OpenClaw

NanoGPT provider plugin for OpenClaw with API-key auth, dynamic model discovery,
and automatic subscription or pay-as-you-go routing.

## Install

```bash
openclaw plugins install @deadronos/openclaw-nanogpt-provider
```
````

## Auth

Set:

```bash
export NANOGPT_API_KEY=your_key_here
```

Or onboard with:

```bash
openclaw onboard --nanogpt-api-key your_key_here
```

## Config

```json5
{
  plugins: {
    entries: {
      nanogpt: {
        enabled: true,
        config: {
          routingMode: "auto",
          catalogSource: "auto",
          provider: "openrouter",
        },
      },
    },
  },
}
```

## Options

- `routingMode`: `auto`, `subscription`, `paygo`
- `catalogSource`: `auto`, `canonical`, `subscription`, `paid`, `personalized`
- `provider`: optional NanoGPT upstream provider id

````

- [ ] **Step 23: Run the full local verification pass**

Run:

```bash
npm test
npm run typecheck
````

Expected:

- PASS

- [ ] **Step 24: Commit the implementation**

Run:

```bash
git add package.json package-lock.json tsconfig.json openclaw.plugin.json index.ts api.ts models.ts runtime.ts provider-catalog.ts onboard.ts index.test.ts runtime.test.ts provider-catalog.test.ts README.md
git commit -m "feat: add NanoGPT OpenClaw provider plugin"
```

## Self-Review

- Spec coverage:
  - Provider registration: covered
  - API-key auth: covered
  - auto/subscription/paygo routing: covered
  - catalog source switching: covered
  - provider selection and billing override: covered
  - fallback catalog behavior: covered
  - docs and package metadata: covered
- Placeholder scan:
  - No `TODO`, `TBD`, or deferred implementation markers remain in the plan tasks
- Type consistency:
  - `routingMode`, `catalogSource`, `provider`, `NANOGPT_API_KEY`, and `nanogpt` are used consistently throughout

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-08-nanogpt-provider-plugin.md`.

Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
