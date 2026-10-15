// @ts-nocheck
import companyLogo from "../assets/worktual-ui-logo.png";
import companyMark from "../assets/worktual-logo.png";

export function BrandLogo({ className = "", mark = false, variant = "light" }) {
  return (
    <span className={`brand-logo brand-logo--${variant} ${className}`.trim()}>
      <img
        alt="Worktual Innovations Pvt Ltd"
        src={mark ? companyMark : companyLogo}
      />
    </span>
  );
}
