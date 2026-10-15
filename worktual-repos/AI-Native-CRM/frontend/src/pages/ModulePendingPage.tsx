import { Link, useLocation } from "react-router-dom";
import { ALL_MODULES, isValidModuleId } from "@/config/modules";

/** Placeholder for unknown / unregistered routes only. */
export function ModulePendingPage() {
  const { pathname } = useLocation();
  const segment = pathname.split("/").filter(Boolean)[0];
  const mod =
    segment && isValidModuleId(segment) ? ALL_MODULES[segment] : null;

  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-xl font-semibold text-text-primary">
        {mod?.label ?? "Not found"}
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        This path is not registered. Head back to the Dashboard to keep going.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/dashboard"
          className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}
