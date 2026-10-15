import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FormLivePreview } from "@/components/events/FormLivePreview";
import {
  bumpFormOpen,
  bumpFormSubmission,
  getOpportunityEventBySlug,
  type OpportunityEvent,
} from "@/lib/opportunity-events-store";
import { createFormSubmission } from "@/lib/form-submissions-store";
import {
  fetchPublicForm,
  publicFormToEvent,
  submitPublicFormReply,
} from "@/lib/public-forms";

function asEvent(
  slug: string,
  remote: ReturnType<typeof publicFormToEvent> | null,
): OpportunityEvent | null {
  const local = getOpportunityEventBySlug(slug);
  if (remote) {
    return {
      ...(local || {
        startsAt: null,
        endsAt: null,
        launchedAt: new Date().toISOString(),
        submissionCount: 0,
        openCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      ...remote,
      kind: "form",
    };
  }
  return local;
}

/**
 * Public form page — no auth. URL: /f/:slug
 * Loads from the campaign backend so LAN links work outside this browser.
 */
export function PublicFormPage() {
  const { slug = "" } = useParams();
  const [event, setEvent] = useState<OpportunityEvent | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing">(
    "loading",
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!slug) {
        setLoadState("missing");
        setEvent(null);
        return;
      }
      setLoadState("loading");
      try {
        const remote = await fetchPublicForm(slug);
        const next = asEvent(slug, remote ? publicFormToEvent(remote) : null);
        if (cancelled) return;
        setEvent(next);
        setLoadState(next ? "ready" : "missing");
      } catch {
        const local = getOpportunityEventBySlug(slug);
        if (cancelled) return;
        setEvent(local);
        setLoadState(local ? "ready" : "missing");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (slug && event?.kind === "form" && event.status !== "ended") {
      bumpFormOpen(slug);
    }
  }, [slug, event?.id, event?.kind, event?.status]);

  useEffect(() => {
    if (!event) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const field of event.formFields) {
        if (next[field.id] === undefined && field.defaultValue) {
          next[field.id] = field.defaultValue;
        }
      }
      return next;
    });
  }, [event]);

  if (loadState === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-subtle px-4">
        <p className="text-sm text-text-caption">Loading form…</p>
      </div>
    );
  }

  if (loadState === "missing" || !event || event.kind !== "form") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-subtle px-4">
        <div className="max-w-md rounded-xl border border-border-default bg-surface p-6 text-center">
          <p className="text-sm font-medium text-text-primary">Form not found</p>
          <p className="mt-1 text-sm text-text-caption">
            This link is not live yet, or the form was removed. Publish the form
            from Events tracking first.
          </p>
        </div>
      </div>
    );
  }

  if (event.status === "ended") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-subtle px-4">
        <div className="max-w-md rounded-xl border border-border-default bg-surface p-6 text-center">
          <p className="text-sm font-medium text-text-primary">
            This form is closed
          </p>
          <p className="mt-1 text-sm text-text-caption">{event.title}</p>
        </div>
      </div>
    );
  }

  if (done) {
    const theme = event.theme;
    return (
      <div
        className="flex min-h-dvh items-center justify-center px-4"
        style={{
          backgroundColor: theme.backgroundColor,
          fontFamily: theme.fontFamily,
          color: theme.textColor,
        }}
      >
        <div
          className="max-w-md p-6 text-center shadow-sm"
          style={{
            backgroundColor: theme.surfaceColor,
            borderRadius: `${theme.borderRadiusPx}px`,
            border: `1px solid ${theme.mutedColor}33`,
          }}
        >
          <p className="text-sm font-medium" style={{ color: theme.textColor }}>
            Submitted
          </p>
          <p
            className="mt-2 text-sm whitespace-pre-wrap"
            style={{ color: theme.mutedColor }}
          >
            {event.thankYouMessage || "Thanks — we received your submission."}
          </p>
        </div>
      </div>
    );
  }

  const onSubmit = async () => {
    setError(null);
    const fields: Record<string, string> = {};
    const answers: Record<string, string> = {};
    for (const field of event.formFields) {
      const v = (values[field.id] || "").trim();
      if (field.required && !v) {
        setError(`${field.label} is required.`);
        return;
      }
      if (field.type === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        setError("Enter a valid work email.");
        return;
      }
      fields[field.id] = v;
      answers[field.label] = v;
    }
    setSaving(true);
    try {
      const slugKey = event.publicSlug || slug;
      const remote = await submitPublicFormReply({
        slug: slugKey,
        answers,
        fields,
      });
      createFormSubmission({
        id: remote.id,
        formId: event.id,
        formSlug: slugKey,
        answers: remote.answers || answers,
        fields: remote.fields || fields,
        createdAt: remote.createdAt,
      });
      setDone(true);
    } catch (err) {
      const localEvent = getOpportunityEventBySlug(slug);
      if (localEvent) {
        createFormSubmission({
          formId: event.id,
          formSlug: event.publicSlug || slug,
          answers,
          fields,
        });
        bumpFormSubmission(event.id);
        setDone(true);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Could not save this reply. Check that the campaign backend is running.",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <FormLivePreview
        event={event}
        interactive
        values={values}
        onChange={(fieldId, value) =>
          setValues((prev) => ({ ...prev, [fieldId]: value }))
        }
        onSubmit={() => {
          if (!saving) void onSubmit();
        }}
        error={error}
      />
      <p className="pb-8 text-center text-[11px] text-text-caption">
        Staff:{" "}
        <Link to="/events" className="text-text-link hover:underline">
          Events tracking
        </Link>
      </p>
    </div>
  );
}
