import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Settings2 } from "lucide-react";
import { ContentFadeIn } from "@/components/skeleton";
import { ConfigurationPageSkeleton } from "@/pages/ConfigurationPageSkeleton";
import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";
import {
  fetchConfigChannels,
  getCachedConfigChannels,
  type ConfigChannel,
} from "@/services/configuration.service";
import { isConfigChannelHidden } from "@/lib/campaign-channels";

const GROUP_LABEL: Record<string, string> = {
  core: "Messaging",
  meta: "WhatsApp",
  ads: "Advertising",
};

function statusLabel(status: string) {
  switch (status) {
    case "ready":
      return "Ready";
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Blocked";
    default:
      return "Not started";
  }
}

function statusClass(status: string) {
  switch (status) {
    case "ready":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "in_progress":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "blocked":
      return "bg-red-50 text-red-800 border-red-200";
    default:
      return "bg-subtle text-text-caption border-border-default";
  }
}

export function ConfigurationPage() {
  const cached = getCachedConfigChannels();
  const [channels, setChannels] = useState<ConfigChannel[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  // Soft-nav: READY once we have cached or fresh content (not stuck on skeleton).
  useEmbedPageReady(!loading || channels.length > 0);

  useEffect(() => {
    let cancelled = false;
    const hadCache = Boolean(getCachedConfigChannels());
    (async () => {
      // Soft-nav re-enter: keep painted UI; refresh in background.
      if (!hadCache) {
        setLoading(true);
        setError(null);
      }
      try {
        const rows = await fetchConfigChannels({ force: true });
        if (!cancelled) {
          setChannels(rows);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && !hadCache) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load configuration",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, ConfigChannel[]>();
    for (const ch of channels) {
      if (isConfigChannelHidden(ch.channel)) continue;
      const list = map.get(ch.group) || [];
      list.push(ch);
      map.set(ch.group, list);
    }
    return Array.from(map.entries());
  }, [channels]);

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-start gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-xl bg-neutral-900 text-white">
          <Settings2 className="size-5" strokeWidth={1.75} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            Configuration
          </h1>
          <p className="mt-1 text-sm text-text-caption">
            Email, Web push, and App push provider keys live in My Accounts
            Channel Setup. Campaign Configuration is for device tokens, site
            origin, and integration keys.
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-border-default bg-surface px-4 py-3 text-sm text-text-danger">
          {error}
        </p>
      ) : loading ? (
        <ConfigurationPageSkeleton />
      ) : (
        <ContentFadeIn className="flex flex-col gap-8">
          {groups.map(([group, rows]) => (
            <section key={group}>
              <h2 className="mb-3 text-xs font-medium tracking-wider text-text-caption uppercase">
                {GROUP_LABEL[group] || group}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map((ch) => (
                  <li key={ch.channel}>
                    <Link
                      to={`/configuration/${ch.channel}`}
                      className="block rounded-2xl border border-border-default bg-surface p-4 transition-colors hover:border-border-strong hover:bg-subtle"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-text-primary">
                          {ch.label}
                        </p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass(ch.status)}`}
                        >
                          {statusLabel(ch.status)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-text-caption">
                        {ch.detail?.trim()
                          ? ch.detail
                          : ch.channel === "app_push"
                            ? ch.source === "my_accounts"
                              ? "Credentials from My Accounts · generate company X-Api-Key here"
                              : "FCM/APNs setup + generate company X-Api-Key"
                            : ch.channel === "email" ||
                                ch.channel === "web_push"
                              ? ch.read_only === false
                                ? "Configure in Campaign"
                                : "Campaign config"
                              : (ch.configs?.length ?? 0) > 0
                                ? `${ch.configs!.length} config(s) from Accounts`
                                : "No configs for this org yet"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </ContentFadeIn>
      )}
    </div>
  );
}
