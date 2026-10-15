import { ccCoreHttp } from "@/services/http";
import { apiV1 } from "@/config/api-paths";

import type {
  OrganizationRecordingInput,
  OrganizationRecordingResponse,
  OrganizationRoutingProfileResponse,
  VoiceRecording,
} from "./types";

export const organizationSettingsApi = {
  async getRoutingProfile(): Promise<OrganizationRoutingProfileResponse> {
    const { data } = await ccCoreHttp.get<OrganizationRoutingProfileResponse>(
      apiV1("/setup/organization/routing-profile"),
    );
    return data;
  },

  async saveRoutingProfile(input: {
    routingTypeId: number;
    longWaitSeconds?: number | null;
  }): Promise<OrganizationRoutingProfileResponse> {
    const { data } = await ccCoreHttp.put<OrganizationRoutingProfileResponse>(
      apiV1("/setup/organization/routing-profile"),
      input,
    );
    return data;
  },

  async listRecordings(page?: {
    limit?: number;
    offset?: number;
    search?: string;
    direction?: string;
    queue?: string;
    agent?: string;
    from?: string;
    to?: string;
  }): Promise<{ recordings: VoiceRecording[]; hasMore: boolean; queues: string[]; agents: string[] }> {
    const { data } = await ccCoreHttp.get<{
      recordings: VoiceRecording[];
      hasMore?: boolean;
      queues?: string[];
      agents?: string[];
    }>(apiV1("/setup/organization/recording/calls"), {
      params: {
        limit: page?.limit ?? 10,
        offset: page?.offset ?? 0,
        ...(page?.search ? { q: page.search } : {}),
        ...(page?.direction && page.direction !== "all" ? { direction: page.direction } : {}),
        ...(page?.queue && page.queue !== "all" ? { queue: page.queue } : {}),
        ...(page?.agent && page.agent !== "all" ? { agent: page.agent } : {}),
        ...(page?.from ? { from: page.from } : {}),
        ...(page?.to ? { to: page.to } : {}),
      },
    });
    return {
      recordings: data.recordings,
      hasMore: Boolean(data.hasMore),
      queues: data.queues ?? [],
      agents: data.agents ?? [],
    };
  },

  async recordingAudio(id: string): Promise<Blob> {
    const { data } = await ccCoreHttp.get<Blob>(
      apiV1(`/setup/organization/recording/calls/${id}/audio`),
      { responseType: "blob" },
    );
    return data;
  },

  async getRecording(): Promise<OrganizationRecordingResponse> {
    const { data } = await ccCoreHttp.get<OrganizationRecordingResponse>(
      apiV1("/setup/organization/recording"),
    );
    return data;
  },

  async saveRecording(input: OrganizationRecordingInput): Promise<OrganizationRecordingResponse> {
    const { data } = await ccCoreHttp.put<OrganizationRecordingResponse>(
      apiV1("/setup/organization/recording"),
      input,
    );
    return data;
  },
};
