export type WorkspaceNote = {
  id: string;
  title: string;
  body: string;
  authorUserId: string;
  authorName: string;
  conversationId: string | null;
  conversationSubject: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceNoteScope = "customer" | "team";

export type WorkspaceNoteWithScope = WorkspaceNote & {
  scope: WorkspaceNoteScope;
};

export type WorkspaceNotesHistoryFilter = "all" | WorkspaceNoteScope;
