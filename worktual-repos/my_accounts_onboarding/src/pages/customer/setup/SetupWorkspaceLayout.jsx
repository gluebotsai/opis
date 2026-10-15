import { Outlet } from "react-router-dom";

import { SetupWorkspaceProvider } from "../../../lib/setup/SetupWorkspaceContext.jsx";

export function SetupWorkspaceLayout() {
  return (
    <SetupWorkspaceProvider>
      <Outlet />
    </SetupWorkspaceProvider>
  );
}
