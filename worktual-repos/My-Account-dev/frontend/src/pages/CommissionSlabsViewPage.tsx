// @ts-nocheck
import { CommissionSlabsReadonly } from "../components/CommissionSlabsReadonly.tsx";

export function CommissionSlabsViewPage({ eyebrow = "Commissions", title = "Commission slabs" }) {
  return (
    <section className="page-stack commission-slabs-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="page-header__copy">
            Active country-based commission rates on paid partner-referred deals.
          </p>
        </div>
      </header>
      <CommissionSlabsReadonly />
    </section>
  );
}
