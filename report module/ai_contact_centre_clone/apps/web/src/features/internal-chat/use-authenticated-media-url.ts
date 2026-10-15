import { useEffect, useState } from "react";

import { fetchInternalChatBlobUrl } from "./api";

function isDirectMediaUrl(pathOrUrl: string): boolean {
  return (
    pathOrUrl.startsWith("blob:") ||
    pathOrUrl.startsWith("data:") ||
    pathOrUrl.startsWith("http://") ||
    pathOrUrl.startsWith("https://")
  );
}

export function useAuthenticatedMediaUrl(pathOrUrl: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pathOrUrl) {
      setUrl(null);
      return;
    }

    if (isDirectMediaUrl(pathOrUrl)) {
      setUrl(pathOrUrl);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void fetchInternalChatBlobUrl(pathOrUrl)
      .then((next) => {
        if (cancelled) {
          URL.revokeObjectURL(next);
          return;
        }
        objectUrl = next;
        setUrl(next);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pathOrUrl]);

  return url;
}
