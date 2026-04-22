/**
 * Manual validation script: verifies response_format injection in wrapStreamFn.
 *
 * Run: node_modules/.bin/tsx scripts/test-response-format-payload.ts
 * Requires: NANO_GPT_API_KEY env var (or .env file)
 *
 * This script does NOT make actual API calls. It exercises the wrapStreamFn
 * pipeline and logs the captured payload to verify injection.
 */

import plugin from "../index.js";

async function main() {
  // Register the provider manually using the plugin's register API.
  const providers: unknown[] = [];
  const mockLogger = {
    warn: (message: string, _meta?: Record<string, unknown>) => { console.warn(message); },
    info: (message: string, _meta?: Record<string, unknown>) => { console.log(message); },
  };

  plugin.register({
    pluginConfig: { enableRepair: false },
    runtime: {
      logging: {
        shouldLogVerbose() {
          return false;
        },
      },
    },
    logger: mockLogger,
    registerProvider(provider: unknown) {
      providers.push(provider);
    },
    registerWebSearchProvider() {},
    registerImageGenerationProvider() {},
  } as never);

  if (providers.length === 0) {
    console.error("ERROR: No providers registered");
    process.exit(1);
  }

  const provider = providers[0] as any;
  const wrapStreamFn = provider?.wrapStreamFn;

  if (!wrapStreamFn) {
    console.error("ERROR: wrapStreamFn not found on provider");
    process.exit(1);
  }

  // Helper to create a stream-like object that supports onPayload.
  function createMockStreamFn(capturedPayloadRef: { current: any }) {
    return async (_model: any, _context: any, options: any) => {
      if (typeof options?.onPayload === "function") {
        capturedPayloadRef.current = await options.onPayload(
          { stream: true, model: "test", messages: [{ role: "user", content: "test" }] },
          {}
        );
      }
      // Return a minimal stream-like object.
      return {
        result: async () => ({ content: [{ type: "text", text: "ok" }], stopReason: "stop" }),
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: true, value: undefined }),
          return: async () => ({ done: true, value: undefined }),
          throw: async () => ({ done: true, value: undefined }),
        }),
      };
    };
  }

  // Test 1: Tool-enabled request — should have response_format.
  {
    let capturedPayload: any = null;
    const capturedPayloadRef = { current: null };
    const baseStreamFn = createMockStreamFn(capturedPayloadRef);

    const wrapped = wrapStreamFn({
      streamFn: baseStreamFn,
      modelId: "moonshotai/kimi-k2.5:thinking",
      model: { id: "moonshotai/kimi-k2.5:thinking", api: "openai-completions" },
      extraParams: {},
    });

    const stream = await wrapped(
      { api: "openai-completions" },
      {
        tools: [{ name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
        messages: [{ role: "user", content: "read a file" }],
      },
      {}
    );
    await stream?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));
    capturedPayload = capturedPayloadRef.current;

    console.log("=== Test 1: Tool-enabled request ===");
    console.log("response_format:", capturedPayload?.response_format);
    console.log("tools present:", capturedPayload?.tools?.length > 0);

    if (capturedPayload?.response_format?.type === "json_object") {
      console.log("PASS: response_format injected for tool-enabled request");
    } else {
      console.log("FAIL: response_format NOT injected");
    }
  }

  // Test 2: Non-tool request — should NOT have response_format.
  {
    let capturedPayload: any = null;
    const capturedPayloadRef = { current: null };
    const baseStreamFn = createMockStreamFn(capturedPayloadRef);

    const wrapped = wrapStreamFn({
      streamFn: baseStreamFn,
      modelId: "moonshotai/kimi-k2.5:thinking",
      model: { id: "moonshotai/kimi-k2.5:thinking", api: "openai-completions" },
      extraParams: {},
    });

    const stream = await wrapped(
      { api: "openai-completions" },
      { messages: [{ role: "user", content: "hello" }] },
      {}
    );
    await stream?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));
    capturedPayload = capturedPayloadRef.current;

    console.log("\n=== Test 2: Non-tool request ===");
    console.log("response_format:", capturedPayload?.response_format);

    if (!capturedPayload?.response_format) {
      console.log("PASS: response_format NOT injected for non-tool request");
    } else {
      console.log("FAIL: response_format was injected (should not be)");
    }
  }

  // Test 3: Tool-enabled with existing response_format — should not override.
  {
    let capturedPayload: any = null;
    const capturedPayloadRef = { current: null };
    // Override onPayload to simulate user already providing response_format.
    const baseStreamFn = async (_model: any, _context: any, options: any) => {
      if (typeof options?.onPayload === "function") {
        // Simulate a payload that already has response_format set by the user.
        capturedPayloadRef.current = await options.onPayload(
          {
            stream: true,
            model: "test",
            messages: [{ role: "user", content: "test" }],
            response_format: { type: "user_provided" },
          },
          {}
        );
      }
      return {
        result: async () => ({ content: [{ type: "text", text: "ok" }], stopReason: "stop" }),
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: true, value: undefined }),
          return: async () => ({ done: true, value: undefined }),
          throw: async () => ({ done: true, value: undefined }),
        }),
      };
    };

    const wrapped = wrapStreamFn({
      streamFn: baseStreamFn,
      modelId: "moonshotai/kimi-k2.5:thinking",
      model: { id: "moonshotai/kimi-k2.5:thinking", api: "openai-completions" },
      extraParams: {},
    });

    const stream = await wrapped(
      { api: "openai-completions" },
      {
        tools: [{ name: "read", parameters: {} }],
        messages: [{ role: "user", content: "test" }],
      },
      {}
    );
    await stream?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));
    capturedPayload = capturedPayloadRef.current;

    console.log("\n=== Test 3: Existing response_format (should not override) ===");
    console.log("response_format:", capturedPayload?.response_format);

    if (capturedPayload?.response_format?.type === "user_provided") {
      console.log("PASS: existing response_format preserved");
    } else {
      console.log("FAIL: response_format was overwritten");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});