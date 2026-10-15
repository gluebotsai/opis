export function DashboardSectionHeader({
  title,
  description,
}: {
  title?: string;
  description: string;
}) {
  return (
    <div>
      {title ? <p className="text-sm font-semibold text-neutral-900">{title}</p> : null}
      <p className={title ? "mt-0.5 text-sm text-neutral-900" : "text-sm text-neutral-900"}>
        {description}
      </p>
    </div>
  );
}
