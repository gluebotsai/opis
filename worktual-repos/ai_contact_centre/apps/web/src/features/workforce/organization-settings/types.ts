export type OrganizationRoutingType = {
  id: number;
  code: string;
  name: string;
  description: string;
  sortOrder: number;
};

export type OrganizationRoutingProfile = {
  routingTypeId: number;
  routingTypeCode: string;
  routingTypeName: string;
  longWaitSeconds: number | null;
  updatedAt: string | null;
};

export type OrganizationRecordingSettings = {
  recordingEnabled: boolean;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  consentNoticeEnabled: boolean;
  consentPromptId: string | null;
  agentAccessEnabled: boolean;
  updatedAt: string | null;
};

export type OrganizationVoicePromptOption = {
  id: string;
  name: string;
};

export type OrganizationRoutingProfileResponse = {
  profile: OrganizationRoutingProfile;
  types: OrganizationRoutingType[];
};

export type OrganizationRecordingResponse = {
  recording: OrganizationRecordingSettings;
  prompts: OrganizationVoicePromptOption[];
};

export type VoiceRecording = {
  id: string;
  startedAt: string;
  direction: "inbound" | "outbound";
  customerName: string;
  customerNumber: string;
  agentName: string | null;
  agentExt: string | null;
  queueName: string | null;
  recordingDurationMs: number;
  recordingUrl: string;
};

export type OrganizationRecordingInput = {
  recordingEnabled: boolean;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  consentNoticeEnabled: boolean;
  consentPromptId: string | null;
  agentAccessEnabled: boolean;
};
