import { apiV1 } from "@/config/api-paths";
import { callServiceHttp } from "@/services/http";

export type OutboundCallerOption = {
  id: string;
  kind: "agent" | "queue";
  phoneNumber: string;
  label: string;
};

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
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  outboundCallerId: string | null;
  outboundOptions: OutboundCallerOption[];
};

export const callServiceApi = {
  async getSipSession(): Promise<SipUaSession> {
    const { data } = await callServiceHttp.get<SipUaSession>(apiV1("/sip/session"));
    return {
      ...data,
      outboundCallerId: data.outboundCallerId ?? null,
      outboundOptions: Array.isArray(data.outboundOptions) ? data.outboundOptions : [],
    };
  },

  async restoreSipRegistrar(): Promise<void> {
    await callServiceHttp.post(apiV1("/sip/session/restore"));
  },
};
