import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { CampaignTemplate } from "@/lib/campaign-templates";
import type { SelectedGalleryImage } from "@/lib/selected-gallery-images";
import { normalizeTemplateMediaUrl } from "@/lib/template-preview-images";
import type { CampaignChannelId } from "@/lib/campaign-channels";

const CHANNEL_BADGE: Record<CampaignChannelId, string> = {
  email: "bg-sky-100 text-sky-800",
  sms: "bg-emerald-100 text-emerald-800",
  whatsapp: "bg-green-100 text-green-800",
  web_push: "bg-violet-100 text-violet-800",
  app_push: "bg-orange-100 text-orange-800",
  ppc: "bg-amber-100 text-amber-900",
};

type Props = {
  templates: CampaignTemplate[];
  images: SelectedGalleryImage[];
  onRemoveTemplate: (templateId: string) => void;
  onRemoveImage: (imageId: string) => void;
  onContinue: () => void;
};

export function CampaignModuleSelectionBar({
  templates,
  images,
  onRemoveTemplate,
  onRemoveImage,
  onContinue,
}: Props) {
  const count = templates.length + images.length;
  if (count === 0) return null;

  return (
    <section className="mb-4 rounded-xl border border-border-default bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">
          Selected for campaign ({count})
        </p>
        <Button type="button" variant="brand" className="h-9" onClick={onContinue}>
          Continue / Use selected
        </Button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {templates.map((t) => (
          <li
            key={`tpl-${t.id}`}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-border-default bg-subtle px-3 py-1.5 text-xs text-text-primary"
          >
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                CHANNEL_BADGE[t.primaryChannel] ??
                "bg-neutral-200 text-neutral-800"
              }`}
            >
              {t.channels[0] || t.primaryChannel}
            </span>
            <span className="truncate font-medium">{t.name}</span>
            <button
              type="button"
              aria-label={`Remove ${t.name}`}
              className="shrink-0 text-text-caption hover:text-text-danger"
              onClick={() => onRemoveTemplate(t.id)}
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          </li>
        ))}
        {images.map((img) => {
          const thumb =
            normalizeTemplateMediaUrl(img.image_url) || img.image_url;
          const label = img.short_description?.trim() || "Gallery image";
          return (
            <li
              key={`img-${img.id}`}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-border-default bg-subtle py-1 pl-1 pr-3 text-xs text-text-primary"
            >
              {thumb ? (
                <img
                  src={thumb}
                  alt=""
                  className="size-7 shrink-0 rounded-full object-cover"
                />
              ) : null}
              <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-700">
                Image
              </span>
              <span className="max-w-[200px] truncate font-medium">{label}</span>
              <button
                type="button"
                aria-label={`Remove ${label}`}
                className="shrink-0 text-text-caption hover:text-text-danger"
                onClick={() => onRemoveImage(img.id)}
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
