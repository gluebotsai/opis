import { useEffect, useState } from "react";
import { Building2, LogOut } from "lucide-react";

import { getSession, SESSION_UPDATED_EVENT } from "../lib/auth.js";
import { getRoleLabel } from "../lib/users.js";

export function SidebarRoleCard() {
  const [session, setSession] = useState(() => getSession());
  const roleLabel = getRoleLabel(session?.role) || "User";
  const displayName = String(session?.displayName || "").trim();
  const primaryLabel = displayName || roleLabel;
  const secondaryLabel = displayName ? session?.email || roleLabel : session?.email || "Signed in";

  useEffect(() => {
    function refreshSession() {
      setSession(getSession());
    }

    window.addEventListener(SESSION_UPDATED_EVENT, refreshSession);
    window.addEventListener("storage", refreshSession);
    return () => {
      window.removeEventListener(SESSION_UPDATED_EVENT, refreshSession);
      window.removeEventListener("storage", refreshSession);
    };
  }, []);

  return (
    <div className="sidebar__tenant">
      <span className="sidebar__tenant-icon">
        <Building2 size={18} strokeWidth={1.75} />
      </span>
      <span>
        <strong>{primaryLabel}</strong>
        <small>{secondaryLabel}</small>
      </span>
    </div>
  );
}

export function SidebarFooter({ onLogout }) {
  return (
    <>
      <SidebarRoleCard />
      <button className="sidebar__logout" onClick={onLogout} type="button">
        <LogOut size={17} strokeWidth={1.75} />
        Logout
      </button>
    </>
  );
}
