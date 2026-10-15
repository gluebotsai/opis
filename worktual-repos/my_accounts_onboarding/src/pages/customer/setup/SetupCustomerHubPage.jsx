import { useMemo, useState } from "react";
import { RefreshCw, Upload, Users } from "lucide-react";

import { useSetupWorkspace } from "../../../lib/setup/SetupWorkspaceContext.jsx";
import {
  SetupPageHeader,
  SetupStatCard,
} from "../../../components/customer/setup/SetupPageChrome.jsx";

const DEMO_IMPORT_CONTACTS = [
  {
    id: "import-1",
    name: "Alex Rivera",
    email: "alex.rivera@northwind.io",
    company: "Northwind Traders",
    phone: "+1 (555) 222-3344",
    sync: "Demo CSV Import",
  },
  {
    id: "import-2",
    name: "Priya Nair",
    email: "priya.nair@contoso.com",
    company: "Contoso Ltd",
    phone: "+91 (44) 5555-7788",
    sync: "Demo CSV Import",
  },
  {
    id: "import-3",
    name: "James Okafor",
    email: "james.okafor@fabrikam.com",
    company: "Fabrikam Inc",
    phone: "+44 (20) 7946-1122",
    sync: "Demo CSV Import",
  },
];

export function SetupCustomerHubPage() {
  const { customerContacts, addCustomerContacts } = useSetupWorkspace();
  const [search, setSearch] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [importPreview, setImportPreview] = useState([]);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return customerContacts;
    }

    return customerContacts.filter((contact) =>
      [contact.name, contact.email, contact.company, contact.phone, contact.sync]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [customerContacts, search]);

  function handlePreviewImport() {
    setImportPreview(DEMO_IMPORT_CONTACTS);
  }

  function handleConfirmImport() {
    addCustomerContacts(importPreview);
    setImportPreview([]);
    setSyncMessage(`${DEMO_IMPORT_CONTACTS.length} contacts imported successfully.`);
  }

  function handleForceSync() {
    setSyncMessage("Customer Hub sync completed. All connected sources are up to date.");
  }

  const uniqueSources = new Set(customerContacts.map((contact) => contact.sync)).size;

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        actions={
          <button className="secondary-button" onClick={handleForceSync} type="button">
            <RefreshCw size={16} />
            Force sync
          </button>
        }
        copy="Central directory of customer contacts synced from CRM, ecommerce, and API sources."
        title="Customer Hub"
      />

      {syncMessage ? <div className="form-success-banner">{syncMessage}</div> : null}

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          <section className="onboarding-card lead-dashboard-panel">
            <div className="lead-dashboard-panel__heading">
              <div className="lead-dashboard-panel__heading-icon">
                <Upload size={18} strokeWidth={2} />
              </div>
              <div>
                <h2>Import contacts</h2>
                <p>Preview and import demo contacts into the Customer Hub.</p>
              </div>
            </div>

            <div className="setup-form-actions" style={{ justifyContent: "flex-start" }}>
              <button className="primary-button" onClick={handlePreviewImport} type="button">
                <Upload size={16} />
                Preview demo import
              </button>
              {importPreview.length ? (
                <button className="secondary-button" onClick={handleConfirmImport} type="button">
                  Confirm import ({importPreview.length})
                </button>
              ) : null}
            </div>

            {importPreview.length ? (
              <div className="setup-table-wrap" style={{ marginTop: "16px" }}>
                <table className="setup-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Company</th>
                      <th>Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.map((contact) => (
                      <tr key={contact.id}>
                        <td>{contact.name}</td>
                        <td>{contact.email}</td>
                        <td>{contact.company}</td>
                        <td>{contact.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <label className="field">
            <span>Search contacts</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, email, company, or source"
              value={search}
            />
          </label>

          <div className="setup-table-wrap">
            <table className="setup-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Company</th>
                  <th>Phone</th>
                  <th>Sync source</th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.length ? (
                  filteredContacts.map((contact) => (
                    <tr key={contact.id}>
                      <td>
                        <strong>{contact.name}</strong>
                      </td>
                      <td>{contact.email}</td>
                      <td>{contact.company}</td>
                      <td>{contact.phone}</td>
                      <td>
                        <span className="setup-chip">{contact.sync}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>No contacts match your search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="setup-workspace-aside">
          <SetupStatCard label="Total contacts" value={customerContacts.length} />
          <SetupStatCard label="Sync sources" value={uniqueSources} />
          <section className="onboarding-card lead-dashboard-panel">
            <div className="lead-dashboard-panel__heading">
              <div className="lead-dashboard-panel__heading-icon">
                <Users size={18} strokeWidth={2} />
              </div>
              <div>
                <h2>Directory</h2>
                <p>
                  Showing {filteredContacts.length} of {customerContacts.length} contacts.
                </p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
