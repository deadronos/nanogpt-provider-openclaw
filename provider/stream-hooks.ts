import type { ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";

type NanoGptWrappedStreamFn = ProviderWrapStreamFnContext["streamFn"];

export function wrapNanoGptStreamFn(
  ctx: ProviderWrapStreamFnContext,
): NanoGptWrappedStreamFn {
  if (ctx.streamFn) {
    return ctx.streamFn;
  }
  return undefined;
}
