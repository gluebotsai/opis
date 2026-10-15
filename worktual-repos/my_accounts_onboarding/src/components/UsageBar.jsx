export function UsageBar({ metric }) {
  return (
    <div className="lead-dashboard-usage">
      <div className="lead-dashboard-usage__header">
        <span>{metric.label}</span>
        <span>
          {metric.used.toLocaleString("en-IN")} / {metric.allocated.toLocaleString("en-IN")}{" "}
          {metric.unit}
        </span>
      </div>
      <div className="lead-dashboard-usage__track">
        <div
          className="lead-dashboard-usage__fill"
          style={{ width: `${metric.percentUsed}%` }}
        />
      </div>
      <div className="lead-dashboard-usage__meta">
        <span>{metric.percentUsed}% used</span>
        <span>
          {metric.remaining.toLocaleString("en-IN")} {metric.unit} remaining
        </span>
      </div>
    </div>
  );
}
