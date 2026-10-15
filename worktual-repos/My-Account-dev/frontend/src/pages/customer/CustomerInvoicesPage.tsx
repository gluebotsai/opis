// @ts-nocheck
import { CustomerInvoicesSection } from "../../components/customer/CustomerInvoicesSection.tsx";

export function CustomerInvoicesPage() {
  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Billing</p>
          <h1>Invoices</h1>
          <p className="page-header__copy">
            Preview and download approved and paid invoices for your account.
          </p>
        </div>
      </header>
      <CustomerInvoicesSection />
    </section>
  );
}
