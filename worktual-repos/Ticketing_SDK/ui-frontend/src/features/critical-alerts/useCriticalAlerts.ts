import { useCallback, useEffect, useRef, useState } from 'react';
import type { CriticalAlert } from '../../types';
import { apiFetchInit } from '../../config/embedAuth';

const fetchOpts = (): RequestInit => apiFetchInit();

const SEVERITY_RANK: Record<CriticalAlert['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function sortAlerts(rows: CriticalAlert[]): CriticalAlert[] {
  return [...rows].sort((a, b) => {
    const sev =
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return a.id.localeCompare(b.id);
  });
}

function mergeAlert(
  prev: CriticalAlert[],
  alert: CriticalAlert
): CriticalAlert[] {
  if (prev.some((row) => row.id === alert.id)) return prev;
  return sortAlerts([...prev, alert]);
}

export function useCriticalAlerts(enabled: boolean) {
  const [queue, setQueue] = useState<CriticalAlert[]>([]);
  const [active, setActive] = useState<CriticalAlert | null>(null);
  const [holdQueue, setHoldQueue] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());

  const loadPending = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch('/api/critical-alerts/pending', fetchOpts());
      if (!res.ok) return;
      const rows = (await res.json()) as CriticalAlert[];
      const fresh = rows.filter((row) => !seenRef.current.has(row.id));
      if (!fresh.length) return;
      setQueue((prev) => {
        let next = prev;
        for (const row of fresh) {
          next = mergeAlert(next, row);
        }
        return sortAlerts(next);
      });
    } catch {
      /* ignore */
    }
  }, [enabled]);

  const ackAlert = useCallback(async (id: string) => {
    seenRef.current.add(id);
    setQueue((prev) => prev.filter((row) => row.id !== id));
    setActive((prev) => (prev?.id === id ? null : prev));
    try {
      await fetch(`/api/critical-alerts/${encodeURIComponent(id)}/ack`, {
        method: 'PATCH',
        ...fetchOpts(),
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void loadPending();
  }, [enabled, loadPending]);

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource('/api/critical-alerts/stream', {
      withCredentials: true,
    });
    const onAlert = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as {
          type?: string;
          alert?: CriticalAlert;
        };
        const alert = data.alert;
        if (!alert?.id || seenRef.current.has(alert.id)) return;
        setQueue((prev) => mergeAlert(prev, alert));
      } catch {
        /* ignore */
      }
    };
    const onAck = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { type?: string; id?: string };
        const id = String(data.id || '');
        if (!id) return;
        seenRef.current.add(id);
        setQueue((prev) => prev.filter((row) => row.id !== id));
        setActive((prev) => (prev?.id === id ? null : prev));
      } catch {
        /* ignore */
      }
    };
    source.addEventListener('alert', onAlert);
    source.addEventListener('ack', onAck);
    return () => {
      source.removeEventListener('alert', onAlert);
      source.removeEventListener('ack', onAck);
      source.close();
    };
  }, [enabled]);

  useEffect(() => {
    if (holdQueue) return;
    if (active) return;
    if (!queue.length) return;
    setActive(queue[0]);
  }, [active, queue, holdQueue]);

  const dismissActive = useCallback(async () => {
    if (!active) return;
    await ackAlert(active.id);
  }, [active, ackAlert]);

  const dismissAll = useCallback(async () => {
    const ids = new Set<string>();
    if (active?.id) ids.add(active.id);
    for (const row of queue) {
      if (row.id) ids.add(row.id);
    }
    for (const id of ids) {
      seenRef.current.add(id);
    }
    setQueue([]);
    setActive(null);
    setHoldQueue(false);
    await Promise.all(
      [...ids].map((id) =>
        fetch(`/api/critical-alerts/${encodeURIComponent(id)}/ack`, {
          method: 'PATCH',
          ...fetchOpts(),
        }).catch(() => undefined)
      )
    );
  }, [active, queue]);

  const holdRemainingAlerts = useCallback(() => {
    setHoldQueue(true);
  }, []);

  const releaseHeldAlerts = useCallback(() => {
    setHoldQueue(false);
  }, []);

  return {
    activeAlert: active,
    alertsHeld: holdQueue,
    dismissActive,
    dismissAll,
    ackAlert,
    holdRemainingAlerts,
    releaseHeldAlerts,
  };
}
