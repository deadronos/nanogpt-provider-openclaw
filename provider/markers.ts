export const NANO_GPT_REASONING_TAG_PAIRS = [
  { open: "<thinking>", close: "</thinking>" },
  { open: "<reasoning>", close: "</reasoning>" },
  { open: "<analysis>", close: "</analysis>" },
] as const;

export const NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS = [
  "<tool>",
  "</tool>",
  "<tool_call>",
  "</tool_call>",
  "<tools>",
  "</tools>",
  "<invoke>",
  "</invoke>",
] as const;

export const NANO_GPT_FUNCTION_CALL_MARKERS = ["<function=", "function="] as const;

export function countNanoGptSubstringOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  const normalizedHaystack = haystack.toLowerCase();
  const normalizedNeedle = needle.toLowerCase();
  let count = 0;
  let index = 0;

  while ((index = normalizedHaystack.indexOf(normalizedNeedle, index)) !== -1) {
    count += 1;
    index += normalizedNeedle.length;
  }

  return count;
}
