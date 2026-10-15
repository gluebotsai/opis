import { useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { uploadTemplateImage } from "@/services/media.api";

type Props = {
  url: string;
  onUrlChange: (url: string) => void;
  compact?: boolean;
  showPreview?: boolean;
};

export function TemplateImagePicker({
  url,
  onUrlChange,
  compact,
  showPreview = true,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [url]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const hosted = await uploadTemplateImage(file);
      setBroken(false);
      onUrlChange(hosted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      {showPreview && url.trim() ? (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
          {broken ? (
            <p className="px-3 py-6 text-center text-[11px] text-text-caption">
              This link did not load as an image. Use Upload, or a public URL
              that returns a picture (extension optional).
            </p>
          ) : (
            <img
              src={url}
              alt=""
              className="mx-auto block h-auto w-full"
              onError={() => setBroken(true)}
              onLoad={() => setBroken(false)}
            />
          )}
        </div>
      ) : null}

      {compact ? null : (
        <Input
          label="Image URL"
          value={url}
          placeholder="https://… (any or no file extension)"
          onChange={(e) => {
            setBroken(false);
            onUrlChange(e.target.value);
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void pick(file);
          }}
        />
        <button
          type="button"
          disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-default bg-white px-3 text-xs font-medium text-text-primary disabled:opacity-50"
          onClick={() => fileRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" strokeWidth={1.75} />
          )}
          {busy ? "Uploading…" : "Upload from computer"}
        </button>
      </div>
      {error ? (
        <p className="text-[11px] text-text-danger" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-[11px] text-text-caption">
          JPEG, PNG, GIF or WebP, up to 3 MB. Public URLs do not need a
          .jpg/.png ending.
        </p>
      )}
    </div>
  );
}
