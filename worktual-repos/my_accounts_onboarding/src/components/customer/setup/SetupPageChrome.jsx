import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

export function SetupPageHeader({ title, copy, actions = null }) {
  return (
    <header className="page-header">
      <div>
        <p className="page-eyebrow">Setup workspace</p>
        <h1>{title}</h1>
        {copy ? <p className="page-header__copy">{copy}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SetupStatusBadge({ status, tone = "neutral" }) {
  return <span className={`setup-status-badge setup-status-badge--${tone}`}>{status}</span>;
}

export function SetupStatCard({ label, value }) {
  return (
    <article className="setup-stat-card">
      <span className="setup-stat-card__label">{label}</span>
      <strong className="setup-stat-card__value">{value}</strong>
    </article>
  );
}

/** Name with optional info icon; description shows in a hover/focus tooltip. */
export function SetupEntityName({ name, description = "", label = "description" }) {
  const [tip, setTip] = useState(null);
  const text = String(description || "").trim();

  function showTip(event) {
    if (!text) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const maxWidth = 280;
    const padding = 12;
    const preferredLeft = rect.left;
    const left = Math.min(
      Math.max(padding, preferredLeft),
      Math.max(padding, window.innerWidth - maxWidth - padding),
    );
    setTip({ text, left, top: rect.bottom + 8, maxWidth });
  }

  function hideTip() {
    setTip(null);
  }

  useEffect(() => {
    if (!tip) return undefined;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [tip]);

  return (
    <>
      <div className="setup-bh-name">
        <strong>{name}</strong>
        {text ? (
          <button
            aria-label={`Show ${label} for ${name}`}
            className="setup-bh-info"
            onBlur={hideTip}
            onClick={(event) => event.stopPropagation()}
            onFocus={showTip}
            onMouseEnter={showTip}
            onMouseLeave={hideTip}
            type="button"
          >
            <Info aria-hidden size={14} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      {tip
        ? createPortal(
            <div
              className="setup-bh-info-tip"
              role="tooltip"
              style={{
                left: tip.left,
                maxWidth: tip.maxWidth,
                top: tip.top,
              }}
            >
              {tip.text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
