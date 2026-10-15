import { useEffect } from "react";
import { meRequest } from "../services/auth";
import { setBootstrapped, setUser, useAppDispatch } from "../store";

export function useAuthBootstrap() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await meRequest();
        if (!cancelled && result.ok) dispatch(setUser(result.user));
        else if (!cancelled) dispatch(setUser(null));
      } catch {
        if (!cancelled) dispatch(setUser(null));
      } finally {
        if (!cancelled) dispatch(setBootstrapped(true));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);
}
