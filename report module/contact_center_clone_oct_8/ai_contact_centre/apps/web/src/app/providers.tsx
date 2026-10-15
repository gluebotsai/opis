import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider } from "antd";
import { useState, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";

import { worktualTheme } from "@/app/theme";
import { SipRegistrationHost } from "@/features/voice/sip-registration-host";
import { store } from "@/store";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider theme={worktualTheme}>
          <AntApp>
            <SipRegistrationHost />
            {children}
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>
    </ReduxProvider>
  );
}
