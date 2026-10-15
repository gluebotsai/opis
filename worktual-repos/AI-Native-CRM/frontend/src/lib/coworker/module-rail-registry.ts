import type { CoworkerSuggestion } from "@/components/coworker/types";
import type { PageCoworkerContext } from "./page-context";

export type CoworkerRailAction = {
  type: "navigate";
  label: string;
  href: string;
};

export type ModuleRailConfig = {
  /** Registry key must match page-context moduleKey */
  key: string;
  label: string;
  welcome: (ctx: PageCoworkerContext) => string;
  chips: (ctx: PageCoworkerContext) => CoworkerSuggestion[];
  /** Optional static navigate hints shown under chips */
  quickLinks?: (ctx: PageCoworkerContext) => CoworkerRailAction[];
};

const registry = new Map<string, ModuleRailConfig>();

export function registerModuleRail(config: ModuleRailConfig) {
  registry.set(config.key, config);
}

export function getModuleRailConfig(key: string | null): ModuleRailConfig | null {
  if (!key) return null;
  return registry.get(key) ?? null;
}

export function isModuleRailEnabled(key: string | null): boolean {
  return Boolean(key && registry.has(key));
}

export function listEnabledRailModules(): string[] {
  return [...registry.keys()];
}

/** Clear registry (tests). */
export function clearModuleRailRegistry() {
  registry.clear();
}
