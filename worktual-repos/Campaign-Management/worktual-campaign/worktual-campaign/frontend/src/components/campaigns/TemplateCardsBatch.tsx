import {
  Bell,
  Eye,
  Mail,
  Megaphone,
  MessageSquare,
  Smartphone,
} from "lucide-react";
import type { DraftTemplateMoment } from "@/lib/campaign-drafts";
import type { TemplateCard } from "@/services/agents.socket";

function channelIcon(channel: string) {
  const c = channel.toLowerCase();
  if (c === "email") return Mail;
  if (c === "ppc") return Megaphone;
  if (c === "sms" || c === "push" || c === "app_push") return Smartphone;
  if (c === "web" || c === "web_push") return Bell;
  return MessageSquare;
}

export function TemplateCardsBatch({
  cards,
  onView,
}: {
  cards: DraftTemplateMoment["cards"];
  onView: (card: TemplateCard) => void;
}) {
  const gridClass =
    cards.length > 1 ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 grid-cols-1";
  return (
    <div className={gridClass}>
      {cards.map((card) => {
        const Icon = channelIcon(card.channel);
        return (
          <div
            key={card.template_id}
            className="relative rounded-xl border border-border-default bg-surface p-4"
          >
            <button
              type="button"
              className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-xs font-medium text-text-primary hover:bg-subtle"
              onClick={() => onView(card as TemplateCard)}
            >
              <Eye className="size-3.5" strokeWidth={1.75} />
              View
            </button>
            <div className="flex items-center gap-3 pr-16">
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-neutral-900 text-white">
                <Icon className="size-5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold capitalize text-text-primary">
                  {card.channel}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
