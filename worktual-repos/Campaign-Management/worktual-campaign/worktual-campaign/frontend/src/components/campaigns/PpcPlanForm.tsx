import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { ChannelTemplatePreview } from "@/components/campaigns/ChannelTemplatePreview";
import type {
  PpcCreativeFormat,
  PpcKeyword,
  PpcKeywordMatch,
  PpcNetwork,
  PpcPlacement,
  PpcTemplatePlan,
} from "@/lib/ppc-templates-store";
import { ppcNetworkLabel } from "@/lib/ppc-templates-store";

const OBJECTIVES = [
  { value: "awareness", label: "Awareness" },
  { value: "traffic", label: "Traffic" },
  { value: "leads", label: "Leads" },
  { value: "sales", label: "Sales" },
];

const META_PLACEMENTS: Array<{ id: PpcPlacement; label: string }> = [
  { id: "feed", label: "Feed" },
  { id: "stories", label: "Stories" },
  { id: "reels", label: "Reels" },
  { id: "audience_network", label: "Audience Network" },
];

const MATCH_OPTIONS: Array<{ value: PpcKeywordMatch; label: string }> = [
  { value: "broad", label: "Broad" },
  { value: "phrase", label: "Phrase" },
  { value: "exact", label: "Exact" },
];

function emptyPlan(network: PpcNetwork): PpcTemplatePlan {
  return {
    network,
    objective: "traffic",
    campaign_type: network === "google" ? "search" : "",
    creative_format: network === "meta" ? "image" : "",
    placements: network === "meta" ? ["feed"] : [],
    headlines: ["", ""],
    primary_text: "",
    descriptions: "",
    cta: "",
    landing_url: "",
    daily_budget: "",
    currency: "INR",
    geo: [],
    keywords: network === "google" ? [{ text: "", match: "phrase" }] : [],
    audience_notes: "",
    media:
      network === "meta"
        ? { type: "image", url: "", alt: "" }
        : undefined,
  };
}

function parseList(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type PpcPlanFormValues = {
  campaignName: string;
  plan: PpcTemplatePlan;
};

export function PpcPlanForm({
  network,
  initial,
  onSave,
  onSaveAndChat,
}: {
  network: PpcNetwork;
  initial?: Partial<PpcPlanFormValues>;
  onSave: (values: PpcPlanFormValues) => void;
  onSaveAndChat?: (values: PpcPlanFormValues) => void;
}) {
  const [campaignName, setCampaignName] = useState(
    initial?.campaignName || "",
  );
  const [plan, setPlan] = useState<PpcTemplatePlan>(() => ({
    ...emptyPlan(network),
    ...initial?.plan,
    network,
  }));
  const [geoText, setGeoText] = useState(
    (initial?.plan?.geo || []).join(", "),
  );
  const [interestText, setInterestText] = useState(
    network === "meta"
      ? (initial?.plan?.keywords || []).map((k) => k.text).join(", ")
      : "",
  );
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const label = ppcNetworkLabel(network);

  const previewFields = useMemo(() => {
    const headlines = plan.headlines.map((h) => h.trim()).filter(Boolean);
    const keywords =
      network === "google"
        ? plan.keywords.filter((k) => k.text.trim())
        : parseList(interestText).map((text) => ({ text }));
    return {
      ...plan,
      headlines,
      geo: parseList(geoText),
      keywords,
      media:
        network === "meta"
          ? {
              type:
                (plan.creative_format as "image" | "video") ||
                plan.media?.type ||
                "image",
              url: plan.media?.url || "",
              alt: plan.media?.alt || "",
            }
          : plan.media,
    };
  }, [plan, geoText, interestText, network]);

  const buildValues = (): PpcPlanFormValues | null => {
    const headlines = plan.headlines.map((h) => h.trim()).filter(Boolean);
    if (headlines.length < 2) {
      setError("Add at least 2 headlines.");
      return null;
    }
    if (plan.primary_text.trim().length < 20) {
      setError("Primary text should be at least a short paragraph.");
      return null;
    }
    const keywords: PpcKeyword[] =
      network === "google"
        ? plan.keywords
            .map((k) => ({
              text: k.text.trim(),
              match: (k.match || "phrase") as PpcKeywordMatch,
            }))
            .filter((k) => k.text)
        : parseList(interestText).map((text) => ({ text }));
    if (network === "google" && keywords.length === 0) {
      setError("Google Search plans need at least one keyword.");
      return null;
    }
    setError("");
    return {
      campaignName: campaignName.trim() || `Untitled ${label} plan`,
      plan: {
        ...plan,
        network,
        campaign_type: network === "google" ? "search" : "",
        headlines,
        geo: parseList(geoText),
        keywords,
        primary_text: plan.primary_text.trim(),
        media:
          network === "meta"
            ? {
                type:
                  plan.creative_format === "video" ? "video" : "image",
                url: plan.media?.url || "",
                alt: plan.media?.alt || "",
              }
            : undefined,
      },
    };
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const values = buildValues();
    if (!values) return;
    onSave(values);
    setShowPreview(true);
  };

  const setHeadline = (index: number, value: string) => {
    setPlan((p) => {
      const headlines = [...p.headlines];
      headlines[index] = value;
      return { ...p, headlines };
    });
  };

  const setKeyword = (
    index: number,
    patch: Partial<PpcKeyword>,
  ) => {
    setPlan((p) => {
      const keywords = [...p.keywords];
      keywords[index] = { ...keywords[index], ...patch };
      return { ...p, keywords };
    });
  };

  const togglePlacement = (id: PpcPlacement) => {
    setPlan((p) => {
      const has = (p.placements || []).includes(id);
      const placements = has
        ? (p.placements || []).filter((x) => x !== id)
        : [...(p.placements || []), id];
      return { ...p, placements };
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-border-default bg-surface p-4 sm:p-5"
    >
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-text-primary">
          {label} plan form
        </h2>
        <p className="mt-1 text-xs text-text-caption">
          Fill the fields this {label} ad plan needs. Plan only — not live
          publish. PPC targeting uses age/geo/interests
          {network === "google" ? " and keywords" : ""} — not contact emails
          or phone numbers.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Plan / campaign name"
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          placeholder={`e.g. ${label} summer promo`}
        />
        <Select
          label="Objective"
          value={plan.objective}
          onChange={(e) =>
            setPlan((p) => ({
              ...p,
              objective: e.target.value as PpcTemplatePlan["objective"],
            }))
          }
          options={OBJECTIVES}
        />

        {network === "meta" ? (
          <>
            <Select
              label="Creative format"
              value={plan.creative_format || "image"}
              onChange={(e) =>
                setPlan((p) => ({
                  ...p,
                  creative_format: e.target.value as PpcCreativeFormat,
                  media: {
                    ...p.media,
                    type:
                      e.target.value === "video" ? "video" : "image",
                  },
                }))
              }
              options={[
                { value: "image", label: "Image" },
                { value: "video", label: "Video" },
                { value: "carousel", label: "Carousel" },
              ]}
            />
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-medium text-text-primary">
                Placements
              </p>
              <div className="flex flex-wrap gap-2">
                {META_PLACEMENTS.map((p) => {
                  const on = (plan.placements || []).includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlacement(p.id)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                        on
                          ? "border-brand bg-brand/10 text-brand"
                          : "border-border-default text-text-secondary"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <Input
              label="Media URL (placeholder)"
              value={plan.media?.url || ""}
              onChange={(e) =>
                setPlan((p) => ({
                  ...p,
                  media: { ...p.media, url: e.target.value },
                }))
              }
              placeholder="https://… or leave blank"
            />
            <Input
              label="Media alt / note"
              value={plan.media?.alt || ""}
              onChange={(e) =>
                setPlan((p) => ({
                  ...p,
                  media: { ...p.media, alt: e.target.value },
                }))
              }
              placeholder="e.g. product video teaser"
            />
          </>
        ) : (
          <Select
            label="Campaign type"
            value={plan.campaign_type || "search"}
            onChange={(e) =>
              setPlan((p) => ({
                ...p,
                campaign_type: e.target.value as "search",
              }))
            }
            options={[{ value: "search", label: "Search" }]}
          />
        )}

        <Input
          label="Headline 1"
          requiredMark
          value={plan.headlines[0] || ""}
          onChange={(e) => setHeadline(0, e.target.value)}
        />
        <Input
          label="Headline 2"
          requiredMark
          value={plan.headlines[1] || ""}
          onChange={(e) => setHeadline(1, e.target.value)}
        />
        <Input
          label="Headline 3 (optional)"
          value={plan.headlines[2] || ""}
          onChange={(e) => setHeadline(2, e.target.value)}
          className="sm:col-span-2"
        />

        <div className="sm:col-span-2">
          <Textarea
            label="Primary text"
            value={plan.primary_text}
            onChange={(e) =>
              setPlan((p) => ({ ...p, primary_text: e.target.value }))
            }
            placeholder="Main ad body / offer copy"
            required
          />
        </div>

        {network === "google" ? (
          <div className="sm:col-span-2">
            <Textarea
              label="Descriptions (RSA-style)"
              value={plan.descriptions || ""}
              onChange={(e) =>
                setPlan((p) => ({ ...p, descriptions: e.target.value }))
              }
              placeholder="Supporting search ad lines"
            />
          </div>
        ) : null}

        <Input
          label="CTA"
          value={plan.cta}
          onChange={(e) => setPlan((p) => ({ ...p, cta: e.target.value }))}
          placeholder="Shop now / Learn more"
        />
        <Input
          label="Landing URL"
          value={plan.landing_url}
          onChange={(e) =>
            setPlan((p) => ({ ...p, landing_url: e.target.value }))
          }
        />
        <Input
          label="Daily budget"
          value={plan.daily_budget}
          onChange={(e) =>
            setPlan((p) => ({ ...p, daily_budget: e.target.value }))
          }
          placeholder="5000"
        />
        <Input
          label="Currency"
          value={plan.currency}
          onChange={(e) =>
            setPlan((p) => ({ ...p, currency: e.target.value }))
          }
        />
        <div className="sm:col-span-2">
          <Input
            label="Geo (comma-separated)"
            value={geoText}
            onChange={(e) => setGeoText(e.target.value)}
            placeholder="Chennai, Bangalore"
          />
        </div>
        <div className="sm:col-span-2">
          <Textarea
            label="Audience notes (age / interests — not emails or phones)"
            value={plan.audience_notes}
            onChange={(e) =>
              setPlan((p) => ({ ...p, audience_notes: e.target.value }))
            }
            placeholder="Ages 25–45; interests: shopping"
          />
        </div>

        {network === "meta" ? (
          <div className="sm:col-span-2">
            <Input
              label="Interest themes (optional, comma-separated)"
              value={interestText}
              onChange={(e) => setInterestText(e.target.value)}
              placeholder="summer sale, online shopping"
            />
          </div>
        ) : (
          <div className="sm:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text-primary">
                Keywords + match type
              </p>
              <Button
                type="button"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() =>
                  setPlan((p) => ({
                    ...p,
                    keywords: [
                      ...p.keywords,
                      { text: "", match: "phrase" },
                    ],
                  }))
                }
              >
                Add keyword
              </Button>
            </div>
            {plan.keywords.map((kw, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_140px]">
                <Input
                  label={i === 0 ? "Keyword" : undefined}
                  value={kw.text}
                  onChange={(e) => setKeyword(i, { text: e.target.value })}
                  placeholder="crm software"
                />
                <Select
                  label={i === 0 ? "Match" : undefined}
                  value={kw.match || "phrase"}
                  onChange={(e) =>
                    setKeyword(i, {
                      match: e.target.value as PpcKeywordMatch,
                    })
                  }
                  options={MATCH_OPTIONS}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <p className="mt-3 text-sm text-text-danger">{error}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" variant="brand" className="h-9">
          Save plan card
        </Button>
        {onSaveAndChat ? (
          <Button
            type="button"
            variant="secondary"
            className="h-9"
            onClick={() => {
              const values = buildValues();
              if (!values) return;
              onSaveAndChat(values);
            }}
          >
            Save & refine with AI
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          className="h-9"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? "Hide preview" : "Preview"}
        </Button>
      </div>

      {showPreview ? (
        <div className="mt-5 border-t border-border-default pt-5">
          <ChannelTemplatePreview channel="ppc" fields={previewFields} />
        </div>
      ) : null}
    </form>
  );
}
