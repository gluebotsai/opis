import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";
import { RegulatedTemplateApprovalsPanel } from "@/components/campaigns/RegulatedTemplateApprovalsPanel";

/** Standalone WhatsApp template approvals — not nested in the template library. */
export function WhatsAppApprovalsWorkspace() {
  useEmbedPageReady(true);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f3f4f6] p-4 sm:p-5">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 shadow-sm">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <RegulatedTemplateApprovalsPanel channel="whatsapp" />
        </div>
      </div>
    </div>
  );
}
