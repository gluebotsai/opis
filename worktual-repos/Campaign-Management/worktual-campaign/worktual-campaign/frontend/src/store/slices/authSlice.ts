import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import axios from "axios";
import {
  loginRequest,
  logoutRequest,
  meRequest,
  type CampaignUser,
} from "@/services/auth.service";
import { getToken } from "@/services/api";
import { hydrateRecommendationsFromServer } from "@/lib/campaign-recommendations-store";
import { hydrateCampaignDraftsFromServer } from "@/lib/campaign-drafts";
import { hydrateOpportunityEventsFromServer } from "@/lib/opportunity-events-store";
import { postGalleryBootstrap } from "@/services/gallery.api";

type AuthState = {
  user: CampaignUser | null;
  status: "idle" | "loading" | "authenticated" | "anonymous";
  error: string | null;
};

const initialState: AuthState = {
  user: null,
  status: "idle",
  error: null,
};

export const bootstrapAuth = createAsyncThunk("auth/bootstrap", async () => {
  const tokenAtStart = getToken();
  if (!tokenAtStart) return null;
  const user = await meRequest();
  // Login may have replaced the JWT while /auth/me was in flight — discard
  // this result (fulfilled handler will not clobber an authenticated user).
  if (getToken() !== tokenAtStart) {
    return null;
  }
  void hydrateRecommendationsFromServer();
  void hydrateOpportunityEventsFromServer();
  void hydrateCampaignDraftsFromServer();
  void postGalleryBootstrap();
  return user;
});

/** Re-validate session after CRM embed token refresh — no loading/unmount flash. */
export const refreshEmbedSession = createAsyncThunk(
  "auth/refreshEmbed",
  async () => {
    if (!getToken()) return null;
    return meRequest();
  },
);

export const login = createAsyncThunk(
  "auth/login",
  async (
    input: { email: string; password: string; remember?: boolean },
    { rejectWithValue },
  ) => {
    try {
      const user = await loginRequest(input);
      if (!user?.id) {
        return rejectWithValue(
          "Sign-in succeeded but the server did not return a user profile.",
        );
      }
      // Defer hydrates so login can settle Redis/session before a request storm
      // hits account DB (that storm was 401'ing and bouncing users to /login).
      Promise.resolve().then(() => {
        window.setTimeout(() => {
          void hydrateRecommendationsFromServer();
          void hydrateOpportunityEventsFromServer();
          void hydrateCampaignDraftsFromServer();
          void postGalleryBootstrap();
        }, 750);
      });
      return user;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        return rejectWithValue(
          (err.response?.data as { message?: string; error?: string })
            ?.message ??
            (err.response?.data as { error?: string })?.error ??
            err.message ??
            "Unable to sign in.",
        );
      }
      if (err instanceof Error && err.message.trim()) {
        return rejectWithValue(err.message);
      }
      if (typeof err === "string" && err.trim()) {
        return rejectWithValue(err);
      }
      return rejectWithValue("Unable to sign in.");
    }
  },
);

export const logout = createAsyncThunk("auth/logout", async () => {
  try {
    const { clearAudienceSessionId } = await import(
      "@/lib/audience-agent-session"
    );
    const { clearHubSessionId } = await import(
      "@/lib/create-campaign-hub-session"
    );
    const { clearDashboardSessionId } = await import(
      "@/lib/dashboard-agent-session"
    );
    clearAudienceSessionId();
    clearHubSessionId();
    clearDashboardSessionId();
  } catch {
    /* ignore storage clear failures */
  }
  await logoutRequest();
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    clearAuthError(state) {
      state.error = null;
    },
    setUser(state, action: PayloadAction<CampaignUser | null>) {
      state.user = action.payload;
      state.status = action.payload ? "authenticated" : "anonymous";
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(bootstrapAuth.pending, (state) => {
        if (!state.user) state.status = "loading";
      })
      .addCase(bootstrapAuth.fulfilled, (state, action) => {
        if (action.payload) {
          state.user = action.payload;
          state.status = "authenticated";
          return;
        }
        // Do not clobber a user that login just set while bootstrap was finishing
        // (common race: bootstrap returns null right after password login succeeds).
        if (state.user && state.status === "authenticated") {
          return;
        }
        state.user = null;
        state.status = "anonymous";
      })
      .addCase(bootstrapAuth.rejected, (state) => {
        if (!state.user) {
          state.user = null;
          state.status = "anonymous";
        }
      })
      .addCase(refreshEmbedSession.fulfilled, (state, action) => {
        state.user = action.payload;
        state.status = action.payload ? "authenticated" : "anonymous";
      })
      .addCase(refreshEmbedSession.rejected, (state) => {
        /* Keep current session visible; 401 handler will request CRM refresh. */
      })
      .addCase(login.pending, (state) => {
        // Keep status as anonymous so LoginPage does not unmount LoginForm
        // (status "loading" swaps the form for a skeleton and drops errors).
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.user = action.payload;
        state.status = "authenticated";
        state.error = null;
      })
      .addCase(login.rejected, (state, action) => {
        state.user = null;
        state.status = "anonymous";
        state.error =
          (typeof action.payload === "string" && action.payload) ||
          action.error.message ||
          "Login failed";
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.status = "anonymous";
      });
  },
});

export const { clearAuthError, setUser } = authSlice.actions;
export default authSlice.reducer;
