import { configureStore } from "@reduxjs/toolkit";

import { authReducer } from "./slices/auth-slice";
import { copilotChatSessionReducer } from "./slices/copilot-chat-session-slice";
import { queueCreateSessionReducer } from "./slices/queue-create-session-slice";
import { workspaceReducer } from "./slices/workspace-slice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    copilotChatSession: copilotChatSessionReducer,
    queueCreateSession: queueCreateSessionReducer,
    workspace: workspaceReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
