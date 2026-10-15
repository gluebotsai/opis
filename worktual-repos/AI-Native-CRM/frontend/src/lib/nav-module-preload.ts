type Preload = () => Promise<void>;

const moduleLoaders = new Map<string, Preload>();
const routeLoaders = new Map<string, Preload>();

/** Register a route chunk so navigation can resolve it before Suspense paints. */
export function registerNavModulePreload(href: string, preload: Preload): void {
  moduleLoaders.set(href, preload);
}

/** Register a submodule/deep route for pointer/focus warming only. */
export function registerRoutePreload(href: string, preload: Preload): void {
  routeLoaders.set(href, preload);
}

/** Start one module chunk. Safe to call on pointer-down before the click navigates. */
export function preloadNavModule(href: string): void {
  const load = moduleLoaders.get(href) ?? routeLoaders.get(href);
  if (load) void load();
}

/** Warm every registered module chunk. Already-loaded pages resolve immediately. */
export function preloadNavModules(): Promise<void> {
  return Promise.all([...moduleLoaders.values()].map((load) => load())).then(
    () => undefined,
  );
}
