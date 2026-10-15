import { useEffect, useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";

import {
  SetupEntityName,
  SetupPageHeader,
  SetupStatCard,
} from "../../../components/customer/setup/SetupPageChrome.jsx";
import { getProductName } from "../../../lib/productCatalog.js";
import { getCrmModuleLabel, isCrmProduct } from "../../../lib/setup/crmModules.js";
import {
  CUSTOM_SETUP_ROLES_ENABLED,
  isDefaultSetupRoleRow,
  selectableSetupRoles,
} from "../../../lib/setup/defaultRoles.js";
import { getBusinessProfile, listRoles } from "../../../lib/setup/setupApi.js";

const PERMISSION_FLAGS = [
  { key: "canView", label: "View" },
  { key: "canCreate", label: "Create" },
  { key: "canEdit", label: "Edit" },
  { key: "canDelete", label: "Delete" },
  { key: "canExport", label: "Export" },
];

function permissionsSummary(role) {
  if (isCrmProduct(role.productId)) {
    const ids = Array.isArray(role.modulePermissions) ? role.modulePermissions : [];
    if (!ids.length) return "No modules";
    const labels = ids.map((id) => getCrmModuleLabel(id));
    if (labels.length <= 4) return labels.join(", ");
    return `${labels.slice(0, 4).join(", ")} +${labels.length - 4}`;
  }
  return PERMISSION_FLAGS.filter((flag) => role[flag.key])
    .map((flag) => flag.label)
    .join(", ");
}

export function SetupRolesPage() {
  const [roles, setRoles] = useState([]);
  const [businessType, setBusinessType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const visibleRoles = useMemo(() => {
    if (CUSTOM_SETUP_ROLES_ENABLED) return roles;
    return selectableSetupRoles(roles);
  }, [roles]);

  async function refresh() {
    const [roleRows, profile] = await Promise.all([listRoles(), getBusinessProfile()]);
    setRoles(roleRows);
    setBusinessType(profile?.businessType || "");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
        if (!cancelled) setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load roles.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        copy={
          CUSTOM_SETUP_ROLES_ENABLED
            ? "Create product-scoped roles. CRM uses module access; other products use view/create/edit/delete/export."
            : "Default product roles are provisioned automatically. Assign them under People. Custom roles are not available yet."
        }
        title="Roles & permissions"
      />

      {error ? (
        <div className="form-error-banner" role="alert">
          <CircleAlert aria-hidden size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="setup-workspace-layout">
        <div className="setup-workspace-main">
          {loading ? (
            <p style={{ fontSize: "13px" }}>Loading roles…</p>
          ) : (
            <div className="setup-table-wrap">
              <table className="setup-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Product</th>
                    <th>Permissions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRoles.map((role) => (
                    <tr key={role.id}>
                      <td>
                        <SetupEntityName
                          description={
                            isDefaultSetupRoleRow(role)
                              ? role.description || "Default role"
                              : role.description
                          }
                          name={role.name}
                        />
                      </td>
                      <td>{role.productId ? getProductName(role.productId) : "—"}</td>
                      <td>{permissionsSummary(role) || "—"}</td>
                    </tr>
                  ))}
                  {!visibleRoles.length ? (
                    <tr>
                      <td colSpan={3}>
                        No default roles yet. They appear after login when the product is active
                        {businessType ? "" : " and (for CRM) business type is set"}.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="setup-workspace-aside">
          <SetupStatCard label="Roles" value={visibleRoles.length} />
          {businessType ? (
            <SetupStatCard label="Business type" value={businessType} />
          ) : null}
        </aside>
      </div>
    </section>
  );
}
