import { useCallback, useEffect, useRef, useState } from 'react';
import { getAnalyticsInsights } from '../api';

const cache = new Map();
const inflight = new Map();

async function fetchInsights(period) {
  const key = period;
  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);

  const promise = getAnalyticsInsights(period)
    .then((res) => {
      cache.set(key, res.data);
      inflight.delete(key);
      return res.data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

export function prefetchAnalyticsInsights(period = 'month') {
  fetchInsights(period).catch(() => {});
}

export function useAnalyticsInsights(initialPeriod = 'month') {
  const [period, setPeriod] = useState(initialPeriod);
  const [data, setData] = useState(() => cache.get(initialPeriod) ?? null);
  const [loading, setLoading] = useState(!cache.has(initialPeriod));
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const load = useCallback(async (nextPeriod, { silent = false } = {}) => {
    const cached = cache.get(nextPeriod);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError(null);
      return cached;
    }

    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const payload = await fetchInsights(nextPeriod);
      if (mounted.current) {
        setData(payload);
        setError(null);
      }
      return payload;
    } catch (err) {
      if (mounted.current && !silent) {
        setData(null);
        const detail = err.response?.data?.detail;
        setError(
          typeof detail === 'string'
            ? detail
            : 'Failed to load analytics insights. Try again or check the API.',
        );
      }
      throw err;
    } finally {
      if (mounted.current && !silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load(period);
    return () => {
      mounted.current = false;
    };
  }, [period, load]);

  return {
    period,
    setPeriod,
    data,
    loading,
    error,
    reload: () => load(period),
  };
}
