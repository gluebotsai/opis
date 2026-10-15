import type { ReactNode } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useNavigationType,
  type To,
} from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { BACK_LINK_CLASS } from "@/lib/ui-tones";
import {
  arrivalHref,
  backTargetIsList,
  isSameEntry,
  locationHref,
  previousInAppHref,
  sourceRecordBack,
} from "@/lib/nav-return";

type BackLinkBase = {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
};

type BackLinkAsLink = BackLinkBase & {
  to: To;
  onClick?: never;
  disabled?: never;
};

type BackLinkAsButton = BackLinkBase & {
  to?: never;
  onClick: () => void;
  disabled?: boolean;
};

export function BackLink(props: BackLinkAsLink | BackLinkAsButton) {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { children, className = "", "aria-label": ariaLabel } = props;
  const classes = `${BACK_LINK_CLASS} ${className}`.trim();

  if ("to" in props && props.to !== undefined) {
    const destination = props.to;
    const fromRecord =
      typeof destination === "string" && backTargetIsList(destination)
        ? sourceRecordBack(
            arrivalHref(
              locationHref(location.pathname, location.search, location.hash),
              undefined,
              navigationType,
            ),
          )
        : null;
    const to = fromRecord?.to ?? destination;
    const label = fromRecord?.label ?? children;
    return (
      <Link
        to={to}
        className={classes}
        aria-label={fromRecord?.label ?? ariaLabel}
        onClick={(event) => {
          if (fromRecord) return;
          if (typeof destination !== "string") return;
          const previous = previousInAppHref();
          if (!previous) return;
          // Going back to the page the user actually came from is a history
          // back, not a new entry. Pushing instead leaves that page on the
          // trail, where it reads as somewhere still to return to.
          if (!backTargetIsList(destination) && !isSameEntry(previous, destination)) {
            return;
          }
          event.preventDefault();
          navigate(-1);
        }}
      >
        <ArrowLeft className="size-4 shrink-0" strokeWidth={1.75} />
        {label}
      </Link>
    );
  }

  const content = (
    <>
      <ArrowLeft className="size-4 shrink-0" strokeWidth={1.75} />
      {children}
    </>
  );

  return (
    <button
      type="button"
      className={classes}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={ariaLabel}
    >
      {content}
    </button>
  );
}
