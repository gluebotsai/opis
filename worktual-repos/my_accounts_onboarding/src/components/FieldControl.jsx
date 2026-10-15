/**
 * Bordered input shell for icon + input (+ optional trailing action).
 * The outer `.field__control` owns the single border; children must not add their own.
 */
export function FieldControl({ icon: Icon, children, className = "" }) {
  const classes = ["field__control", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      {Icon ? <Icon aria-hidden className="field__control-icon" size={18} strokeWidth={1.75} /> : null}
      {children}
    </div>
  );
}
