import { TemplateLibraryClient } from "@/components/campaigns/TemplateLibraryClient";

export default function TemplatesPage() {
  return <TemplateLibraryClient createBasePath="/campaigns/create" />;
}
