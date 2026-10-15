import { createContext, useContext } from "react";

type SidebarLayoutContextValue = {
  collapsed: boolean;
};

const SidebarLayoutContext = createContext<SidebarLayoutContextValue>({ collapsed: false });

export function SidebarLayoutProvider({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <SidebarLayoutContext.Provider value={{ collapsed }}>{children}</SidebarLayoutContext.Provider>
  );
}

export function useSidebarLayout() {
  return useContext(SidebarLayoutContext);
}
