import { useCallback, useEffect, useRef, useState } from "react";

import { readAuthFromStorage } from "@/services/http";
import { getOrCreateWorkspaceSocket } from "@/features/workspace/workspace-socket-client";
import { monitoringApi, type MonitoringSnapshot } from "@/features/monitoring/api";

const POLL_MS = 5_000;

export function useMonitoringLive() {
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const inflightRef = useRef(false);

  const load = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await monitoringApi.getSnapshot();
      setSnapshot(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load live monitoring");
    } finally {
      inflightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");
    const poll = window.setInterval(() => void load("refresh"), POLL_MS);
    return () => window.clearInterval(poll);
  }, [load]);

  useEffect(() => {
    const auth = readAuthFromStorage();
    if (!auth.token) return;

    const socket = getOrCreateWorkspaceSocket(auth);
    const handleConnect = () => setLiveConnected(true);
    const handleDisconnect = () => setLiveConnected(false);
    const handleRefresh = () => void load("refresh");

    setLiveConnected(socket.connected);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("conversation.created", handleRefresh);
    socket.on("conversation.queued", handleRefresh);
    socket.on("conversation.assigned", handleRefresh);
    socket.on("conversation.accepted", handleRefresh);
    socket.on("conversation.offer", handleRefresh);
    socket.on("conversation.rejected", handleRefresh);
    socket.on("conversation.resolved", handleRefresh);
    socket.on("conversation.ended", handleRefresh);
    socket.on("conversation.transferred", handleRefresh);
    socket.on("presence.updated", handleRefresh);
    socket.on("missed_contact.created", handleRefresh);
    socket.on("monitoring.updated", handleRefresh);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("conversation.created", handleRefresh);
      socket.off("conversation.queued", handleRefresh);
      socket.off("conversation.assigned", handleRefresh);
      socket.off("conversation.accepted", handleRefresh);
      socket.off("conversation.offer", handleRefresh);
      socket.off("conversation.rejected", handleRefresh);
      socket.off("conversation.resolved", handleRefresh);
      socket.off("conversation.ended", handleRefresh);
      socket.off("conversation.transferred", handleRefresh);
      socket.off("presence.updated", handleRefresh);
      socket.off("missed_contact.created", handleRefresh);
      socket.off("monitoring.updated", handleRefresh);
    };
  }, [load]);

  return {
    snapshot,
    loading,
    refreshing,
    error,
    liveConnected,
    refresh: () => load("refresh"),
  };
}
