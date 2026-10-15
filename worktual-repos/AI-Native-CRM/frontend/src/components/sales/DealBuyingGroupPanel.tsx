import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import {
  BUYING_ATTITUDE,
  BUYING_INFLUENCE,
  BUYING_ROLES,
  buyingRoleLabel,
  fetchDealBuyingGroup,
  setCompanyBuyingRole,
  type BuyingGroup,
} from "@/services/buying-group";

export function DealBuyingGroupPanel({
  dealId,
  companyId,
}: {
  dealId: string;
  companyId: string;
}) {
  const [group, setGroup] = useState<BuyingGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contactId, setContactId] = useState("");
  const [role, setRole] = useState("economic_buyer");
  const [influence, setInfluence] = useState("high");
  const [attitude, setAttitude] = useState("neutral");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchDealBuyingGroup(dealId);
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error || "Buying group is unavailable right now.");
        return;
      }
      setGroup(result.buyingGroup);
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  async function saveRole() {
    if (!contactId) return;
    setSaving(true);
    const saved = await setCompanyBuyingRole(companyId, {
      contactId,
      dealId,
      role,
      influence,
      attitude,
    });
    if (!saved.ok) {
      setSaving(false);
      setError(saved.error || "Could not save that role.");
      return;
    }
    const refreshed = await fetchDealBuyingGroup(dealId);
    setSaving(false);
    if (refreshed.ok) {
      setGroup(refreshed.buyingGroup);
      setError(null);
    }
  }

  if (error && !group) {
    return <p className="text-sm text-text-danger">{error}</p>;
  }
  if (!group) return null;

  const dealRoles = group.roles.filter((item) => item.dealId === dealId || item.dealId == null);

  return (
    <section className="rounded-xl border border-border-default bg-surface p-4">
      <h2 className="text-base font-semibold text-text-primary">Buying group</h2>
      {group.warnings.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {group.warnings.map((warning) => (
            <li key={warning} className="text-sm text-text-danger">
              {warning}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-text-caption">
          An economic buyer and a champion are confirmed, and the deal is not resting on one person.
        </p>
      )}
      {error ? <p className="mt-2 text-sm text-text-danger">{error}</p> : null}
      {dealRoles.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {dealRoles.map((item) => (
            <li key={item.id} className="text-sm text-text-primary">
              <span className="font-medium">{item.contactName}</span>
              {" · "}
              {buyingRoleLabel(item.role)}
              {item.dealId ? " on this deal" : " on the company"}
              {item.status === "suggested" ? " · suggested" : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {group.contacts.length > 0 ? (
        <div className="mt-4 space-y-3">
          <Select
            label="Contact"
            value={contactId}
            options={[
              { value: "", label: "Choose a contact" },
              ...group.contacts.map((person) => ({ value: person.id, label: person.name })),
            ]}
            onChange={(event) => setContactId(event.target.value)}
          />
          <Select
            label="Role on this deal"
            value={role}
            options={BUYING_ROLES.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(event) => setRole(event.target.value)}
          />
          <Select
            label="Influence"
            value={influence}
            options={BUYING_INFLUENCE}
            onChange={(event) => setInfluence(event.target.value)}
          />
          <Select
            label="Attitude"
            value={attitude}
            options={BUYING_ATTITUDE}
            onChange={(event) => setAttitude(event.target.value)}
          />
          <Button variant="secondary" disabled={!contactId || saving} onClick={() => void saveRole()}>
            Save role on this deal
          </Button>
        </div>
      ) : null}
    </section>
  );
}
