/**
 * Worktual content panel — white rounded-2xl, 0.6px hairline, shadow-none on canvas.
 */
export default function ReportsMainPanel({
  title,
  subtitle,
  headerAside,
  children,
  className = '',
  bodyClassName = '',
  id,
}) {
  const hasHeader = title || subtitle || headerAside;
  const bodyClasses = ['reports-main-panel-body', bodyClassName].filter(Boolean).join(' ');

  return (
    <section id={id} className={`reports-main-panel${className ? ` ${className}` : ''}`}>
      {hasHeader ? (
        <div className="reports-main-panel-header">
          <div className="reports-main-panel-heading">
            {title ? <h2 className="reports-main-panel-title">{title}</h2> : null}
            {subtitle ? (
              typeof subtitle === 'string' ? (
                <p className="reports-main-panel-desc">{subtitle}</p>
              ) : (
                <div className="reports-main-panel-desc">{subtitle}</div>
              )
            ) : null}
          </div>
          {headerAside ? <div className="reports-main-panel-aside">{headerAside}</div> : null}
        </div>
      ) : null}
      {children ? <div className={bodyClasses}>{children}</div> : null}
    </section>
  );
}
