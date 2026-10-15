import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EmailConfigurationPage } from "@/pages/EmailConfigurationPage";
import { PushConfigurationPage } from "@/pages/PushConfigurationPage";
import { ChannelConfigStubPage } from "@/pages/ChannelConfigStubPage";
import { isConfigChannelHidden } from "@/lib/campaign-channels";

/** Dispatches /configuration/:channel to the right config UI. */
export function ConfigurationChannelPage() {
  const { channel } = useParams();
  const id = String(channel || "")
    .trim()
    .toLowerCase();

  let page: ReactNode;
  if (!id || isConfigChannelHidden(id)) {
    page = <Navigate to="/configuration" replace />;
  } else if (id === "email") {
    page = <EmailConfigurationPage />;
  } else if (id === "web_push" || id === "app_push") {
    page = <PushConfigurationPage />;
  } else {
    page = <ChannelConfigStubPage />;
  }

  return <ErrorBoundary label="Configuration">{page}</ErrorBoundary>;
}
