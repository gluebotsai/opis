import { X } from "lucide-react";
import { ImageGalleryView } from "@/components/campaigns/ImageGalleryView";

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (imageUrl: string) => void;
};

/** Choose an existing gallery image (e.g. template preview) without leaving the current form. */
export function ImageGalleryPickerModal({ open, onClose, onPick }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border-default bg-surface shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-default px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              Choose from gallery
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              Pick an image for this template preview. Your template form stays
              open in the background.
            </p>
          </div>
          <button
            type="button"
            className="text-text-caption hover:text-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ImageGalleryView
            active
            mode="pick"
            onPick={(url) => {
              onPick(url);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
