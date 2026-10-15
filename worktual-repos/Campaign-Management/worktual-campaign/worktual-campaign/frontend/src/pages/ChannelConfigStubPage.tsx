import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ContentFadeIn } from "@/components/skeleton";
import { ChannelConfigStubSkeleton } from "@/pages/ChannelConfigStubSkeleton";
import {
  fetchChannelConfig,
  type ChannelConfigDetail,
} from "@/services/configuration.service";

/** Read-only Accounts setup view for non-email channels. */
export function ChannelConfigStubPage() {
  const { channel: paramChannel } = useParams();
  const channel = paramChannel || "sms";
  const [detail, setDetail] = useState<ChannelConfigDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await fetchChannelConfig(channel);
        if (!cancelled) setDetail(next);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load channel config",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channel]);

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <Link
        to="/configuration"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        All channels
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-text-primary">
        {detail?.label || channel}
      </h1>
      <p className="mt-1 text-sm text-text-caption">
        Read-only from Accounts setup. Campaign email config is under Email.
      </p>

      {error ? (
        <p className="mt-4 rounded-xl border border-border-default bg-surface px-4 py-3 text-sm text-text-danger">
          {error}
        </p>
      ) : null}

      {loading ? (
        <ChannelConfigStubSkeleton />
      ) : (
        <ContentFadeIn className="mt-6 rounded-2xl border border-border-default bg-surface p-5">
          <p className="text-sm text-text-secondary">
            {detail?.message ||
              "Channel configuration is managed in Accounts setup."}
          </p>
          <p className="mt-2 text-xs text-text-caption">
            Status: <span className="font-medium">{detail?.status || "—"}</span>
          </p>
          {(detail?.configs?.length ?? 0) === 0 ? (
            <p className="mt-4 text-sm text-text-caption">
              No channel configs found for this organization.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border-default">
              {detail?.configs?.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {c.name}
                    </p>
                    <p className="text-xs text-text-caption">
                      {c.channel_type} · {c.status}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ContentFadeIn>
      )}
    </div>
  );
}
