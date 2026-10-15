import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Run an async load once per mount cycle (or when deps/reload tick change),
 * ignore stale results after unmount, and skip duplicate Strict Mode double-invoke.
 */
export function useLoadOnce<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => {
    setReloadTick((n) => n + 1);
  }, []);

  const hasLoadedRef = useRef(false);

  useEffect(() => {
    hasLoadedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset cache when caller deps change
  }, deps);

  useEffect(() => {
    let cancelled = false;
    const silentRefresh = reloadTick > 0 && hasLoadedRef.current;
    if (!silentRefresh) {
      setLoading(true);
      setError(null);
    }

    void loaderRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          hasLoadedRef.current = true;
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Request failed");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller owns deps
  }, [...deps, reloadTick]);

  return { data, error, loading, reload };
}
