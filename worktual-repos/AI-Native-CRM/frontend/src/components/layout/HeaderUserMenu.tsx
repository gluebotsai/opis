import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { resetDailyBriefingSession } from "@/components/home/DailyBriefingPlayer";
import { clearPresenceLoginFlag } from "@/features/voice/agent-presence";
import { clearCoworkerClientStorage } from "@/lib/coworker/coworker-client-storage";
import { clearNavReturnStorage } from "@/lib/nav-return";
import { clearAllListCaches } from "@/lib/list-cache";
import { resetAudioUnlock } from "@/lib/unlock-audio";
import { type AppRole, normalizeRole } from "@/lib/rbac";
import { logoutRequest, type AuthUser } from "@/services/auth";
import { setUser, useAppDispatch } from "@/store";

function roleDisplayLabel(role: string): string {
  const labels: Record<AppRole, string> = {
    admin: "Admin",
    sales_manager: "Sales manager",
    sales_rep: "Sales rep",
    presales: "Presales",
    marketing: "Marketing",
    finance: "Finance",
    viewer: "Viewer",
  };
  return labels[normalizeRole(role)];
}

export function HeaderUserMenu({ user }: { user: AuthUser }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    setOpen(false);
    clearPresenceLoginFlag();
    await logoutRequest();
    clearCoworkerClientStorage();
    clearNavReturnStorage();
    clearAllListCaches();
    dispatch(setUser(null));
    resetDailyBriefingSession();
    resetAudioUnlock();
    navigate("/login", { replace: true });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`inline-flex size-9 items-center justify-center rounded-full bg-[#111111] text-sm font-semibold text-white ring-2 transition-shadow ${
          open ? "ring-[#2563eb]" : "ring-white"
        }`}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        {user.initials}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-2 w-[min(calc(100vw-1.5rem),17.5rem)] overflow-hidden rounded-xl border border-[#bfbfbf] bg-white shadow-lg"
        >
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[#111111] text-sm font-semibold text-white">
              {user.initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900">
                {user.name}
              </p>
              <p className="truncate text-xs text-neutral-500">{user.email}</p>
            </div>
          </div>

          <dl className="border-y border-neutral-100 px-4 py-2 text-sm">
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-neutral-500">Role</dt>
              <dd className="font-medium text-neutral-900">
                {roleDisplayLabel(user.role)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-neutral-500">Org</dt>
              <dd className="truncate font-medium text-neutral-900">
                {user.orgName || "—"}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
            onClick={() => void logout()}
          >
            <LogOut className="size-4 text-neutral-500" strokeWidth={2} />
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}
