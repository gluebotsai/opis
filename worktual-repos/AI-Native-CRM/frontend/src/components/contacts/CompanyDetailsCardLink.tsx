import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

/** Double-click anywhere on the card (except links/buttons) opens the company. */
export function CompanyDetailsCardLink({
  companyId,
  children,
}: {
  companyId: string | null | undefined;
  children: ReactNode;
}) {
  const navigate = useNavigate();

  return (
    <section
      className={`rounded-xl border border-border-default bg-surface p-5 transition-colors ${
        companyId ? "cursor-pointer hover:border-border-strong hover:bg-subtle/60" : ""
      }`}
      title={companyId ? "Double-click to open company" : undefined}
      onDoubleClick={(e) => {
        if (!companyId) return;
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        e.preventDefault();
        e.stopPropagation();
        navigate(`/company/${companyId}`);
      }}
    >
      {children}
    </section>
  );
}
