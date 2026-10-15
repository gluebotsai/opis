import { ccCoreHttp } from "@/services/http";
import { apiV1 } from "@/config/api-paths";

import type { WorkspaceNote } from "./notes-types";

export const workspaceNotesApi = {
  async listVisitorNotes(visitorId: string, contactId?: string | null): Promise<WorkspaceNote[]> {
    const { data } = await ccCoreHttp.get<{ notes: WorkspaceNote[] }>(
      `${apiV1(`/workspace/visitors/${encodeURIComponent(visitorId)}/notes`)}`,
      { params: contactId ? { contactId } : undefined },
    );
    return data.notes;
  },

  async listCommonNotes(): Promise<WorkspaceNote[]> {
    const { data } = await ccCoreHttp.get<{ notes: WorkspaceNote[] }>(
      apiV1("/workspace/common-notes"),
    );
    return data.notes;
  },

  async saveConversationNote(
    conversationId: string,
    input: { title: string; body: string },
  ): Promise<WorkspaceNote> {
    const { data } = await ccCoreHttp.post<{ note: WorkspaceNote }>(
      `${apiV1(`/workspace/conversations/${conversationId}/notes`)}`,
      input,
    );
    return data.note;
  },

  async saveCommonNote(input: { title: string; body: string }): Promise<WorkspaceNote> {
    const { data } = await ccCoreHttp.post<{ note: WorkspaceNote }>(
      apiV1("/workspace/common-notes"),
      input,
    );
    return data.note;
  },
};
