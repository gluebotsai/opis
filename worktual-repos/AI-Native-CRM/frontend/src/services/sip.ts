import { api } from "./api";
import type { IceServerConfig } from "@/features/voice/sip-via-host";

export type SipUaSession = {
  wssUrl: string;
  uri: string;
  registrarServer: string;
  authorizationUser: string;
  password: string;
  displayName: string;
  userAgent: string;
  realm: string;
  expires: number;
  ext: string;
  redisKey: string;
  redisRegistered: boolean;
  outboundCallerId: string | null;
  iceServers: IceServerConfig[];
};

type SipSessionResponse = { ok: true } & SipUaSession;

export async function getSipSession(): Promise<SipUaSession | null> {
  const response = await api.get<SipSessionResponse | { ok: false; error?: string }>(
    "/api/sip/session",
  );
  if (response.status === 404 || !response.data.ok) return null;
  return response.data;
}

export async function restoreSipRegistrar(): Promise<void> {
  await api.post("/api/sip/session/restore");
}
