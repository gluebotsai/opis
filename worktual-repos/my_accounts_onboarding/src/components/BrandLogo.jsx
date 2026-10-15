import companyLogo from "../../image.png";

export function BrandLogo({ className = "", variant = "light" }) {
  return (
    <span className={`brand-logo brand-logo--${variant} ${className}`.trim()}>
      <img src={companyLogo} alt="Worktual" />
    </span>
  );
}
