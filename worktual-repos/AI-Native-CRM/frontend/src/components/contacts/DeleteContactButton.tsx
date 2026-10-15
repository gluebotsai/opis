import { useNavigate } from "react-router-dom";
import { deleteContact } from "@/services/contacts";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";

export function DeleteContactButton({
  id,
  name,
  compact = false,
  menuItem = false,
  onDeleted,
}: {
  id: string;
  name: string;
  compact?: boolean;
  /** Row inside a More menu. */
  menuItem?: boolean;
  /** When set (e.g. list rows), called instead of navigating to /contact. */
  onDeleted?: () => void;
}) {
  const navigate = useNavigate();

  return (
    <ConfirmDeleteButton
      name={name}
      entityLabel="contact"
      compact={compact}
      menuItem={menuItem}
      consequence="This permanently removes the contact and related activity history."
      onConfirm={async () => {
        const result = await deleteContact(id);
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true };
      }}
      onSuccess={() => {
        if (onDeleted) {
          onDeleted();
          return;
        }
        navigate("/contact");
      }}
    />
  );
}
