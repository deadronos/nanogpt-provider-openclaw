import { createRequire } from "node:module";

type OpenClawDiscoveryProvider = {
  id: string;
  aliases?: string[];
  hookAliases?: string[];
  catalog?: { run: (params: unknown) => unknown };
  discovery?: { run: (params: unknown) => unknown };
};

type ResolvePluginDiscoveryProvidersRuntime = (params: {
  config?: unknown;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  onlyPluginIds?: string[];
  includeUntrustedWorkspacePlugins?: boolean;
  requireCompleteDiscoveryEntryCoverage?: boolean;
}) => OpenClawDiscoveryProvider[];

export function resolvePluginDiscoveryProvidersRuntime(params: {
  config?: unknown;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  onlyPluginIds?: string[];
  includeUntrustedWorkspacePlugins?: boolean;
  requireCompleteDiscoveryEntryCoverage?: boolean;
}): OpenClawDiscoveryProvider[] {
  const require = createRequire(import.meta.url);
  const runtime = require("./node_modules/openclaw/dist/plugins/provider-discovery.runtime.js") as {
    resolvePluginDiscoveryProvidersRuntime: ResolvePluginDiscoveryProvidersRuntime;
  };

  return runtime.resolvePluginDiscoveryProvidersRuntime(params);
}
