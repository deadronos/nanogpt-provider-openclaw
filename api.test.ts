import { describe, it, expect } from "vitest";
import * as api from "./api.js";

describe("api", () => {
  it("should export models constants and functions", () => {
    expect(api.NANOGPT_BASE_URL).toBeDefined();
    expect(api.NANOGPT_DEFAULT_MODEL_ID).toBeDefined();
    expect(api.NANOGPT_DEFAULT_MODEL_REF).toBeDefined();
    expect(api.NANOGPT_FALLBACK_MODELS).toBeDefined();
    expect(api.NANOGPT_PAID_BASE_URL).toBeDefined();
    expect(api.NANOGPT_PERSONALIZED_BASE_URL).toBeDefined();
    expect(api.NANOGPT_PROVIDER_ID).toBeDefined();
    expect(api.NANOGPT_SUBSCRIPTION_BASE_URL).toBeDefined();
    expect(api.buildNanoGptModelDefinition).toBeDefined();
  });

  it("should export onboard functions", () => {
    expect(api.applyNanoGptConfig).toBeDefined();
    expect(api.applyNanoGptProviderConfig).toBeDefined();
  });

  it("should export provider-catalog functions", () => {
    expect(api.buildNanoGptProvider).toBeDefined();
  });

  it("should export image-generation-provider functions", () => {
    expect(api.buildNanoGptImageGenerationProvider).toBeDefined();
  });

  it("should export web-search functions", () => {
    expect(api.createNanoGptWebSearchProvider).toBeDefined();
  });

  it("should export runtime functions", () => {
    expect(api.buildNanoGptRequestHeaders).toBeDefined();
    expect(api.fetchNanoGptUsageSnapshot).toBeDefined();
    expect(api.discoverNanoGptModels).toBeDefined();
    expect(api.getNanoGptConfig).toBeDefined();
    expect(api.resolveNanoGptRequestApi).toBeDefined();
    expect(api.probeNanoGptSubscription).toBeDefined();
    expect(api.resetNanoGptRuntimeState).toBeDefined();
    expect(api.resolveCatalogBaseUrl).toBeDefined();
    expect(api.resolveCatalogSource).toBeDefined();
    expect(api.resolveNanoGptRoutingMode).toBeDefined();
    expect(api.resolveRequestBaseUrl).toBeDefined();
    expect(api.resolveNanoGptUsageAuth).toBeDefined();
  });

  it("should not export undefined members", () => {
    const expectedExports = [
      "NANOGPT_BASE_URL",
      "NANOGPT_DEFAULT_MODEL_ID",
      "NANOGPT_DEFAULT_MODEL_REF",
      "NANOGPT_FALLBACK_MODELS",
      "NANOGPT_PAID_BASE_URL",
      "NANOGPT_PERSONALIZED_BASE_URL",
      "NANOGPT_PROVIDER_ID",
      "NANOGPT_SUBSCRIPTION_BASE_URL",
      "buildNanoGptModelDefinition",
      "applyNanoGptConfig",
      "applyNanoGptProviderConfig",
      "buildNanoGptProvider",
      "buildNanoGptImageGenerationProvider",
      "createNanoGptWebSearchProvider",
      "buildNanoGptRequestHeaders",
      "fetchNanoGptUsageSnapshot",
      "discoverNanoGptModels",
      "getNanoGptConfig",
      "resolveNanoGptRequestApi",
      "probeNanoGptSubscription",
      "resetNanoGptRuntimeState",
      "resolveCatalogBaseUrl",
      "resolveCatalogSource",
      "resolveNanoGptRoutingMode",
      "resolveRequestBaseUrl",
      "resolveNanoGptUsageAuth"
    ];

    const actualExports = Object.keys(api);

    for (const expected of expectedExports) {
      expect(actualExports).toContain(expected);
    }
  });
});
