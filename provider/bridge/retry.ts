export function buildNanoGptBridgeRetrySystemMessage(protocol: "object" | "xml"): string {
  return protocol === "object"
    ? "Your previous response was invalid because it contained no visible content or tool call. Return exactly one valid JSON turn object that matches the required bridge contract. Do not return an empty response."
    : "Your previous response was invalid because it contained no visible content and no XML tool call. Do not return an empty response. If you need to act, emit the XML tool call now. If no tool is needed, provide a normal visible reply.";
}
