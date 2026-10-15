// @ts-nocheck
import { AccountSettingsForm } from "../components/AccountSettingsForm.tsx";

export function AccountSettingsPage({ title = "My Profile" }) {
  return (
    <section className="account-settings-page">
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="page-header__copy">Manage your login profile and password.</p>
        </div>
      </header>

      <div className="account-settings-modal">
        <AccountSettingsForm />
      </div>
    </section>
  );
}
