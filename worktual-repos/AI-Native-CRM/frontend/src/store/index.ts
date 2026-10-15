import { configureStore } from "@reduxjs/toolkit";
import {
  useDispatch,
  useSelector,
  type TypedUseSelectorHook,
} from "react-redux";
import { authReducer } from "./authSlice";
import { notificationsReducer } from "./notificationsSlice";
import { shellReducer } from "./shellSlice";

export { setUser, setBootstrapped } from "./authSlice";
export { setUnreadCount, setIncomingToast } from "./notificationsSlice";
export {
  setSidebarCollapsed,
  toggleSidebarCollapsed,
  setMobileNavOpen,
  hydrateCoworkerRailOpen,
  setCoworkerRailOpen,
  setCoworkerExpand,
  toggleCoworkerExpand,
} from "./shellSlice";
export type { CoworkerExpand } from "./shellSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    shell: shellReducer,
    notifications: notificationsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
