import { describe, expect, it } from "vitest";
import plugin from "./index.js";

describe("nanogpt plugin entry", () => {
  it("exports the expected plugin metadata", () => {
    expect(plugin.id).toBe("nanogpt");
    expect(plugin.name).toBe("NanoGPT Provider");
    expect(plugin.description).toContain("NanoGPT");
    expect(typeof plugin.register).toBe("function");
  });
});
