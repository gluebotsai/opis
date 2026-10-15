import { Camera, LoaderCircle, Search, Users, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { listRowDividerClassName } from "@/components/ui/list-row";
import { useAuthenticatedMediaUrl } from "@/features/internal-chat/use-authenticated-media-url";
import type {
  InternalChatGroupCategory,
  InternalChatMember,
  InternalChatRoom,
  InternalChatUpdateGroupPayload,
} from "@/features/internal-chat/types";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";

const GROUP_CATEGORIES: { id: InternalChatGroupCategory; label: string }[] = [
  { id: "supervision", label: "Supervision" },
  { id: "shift_handover", label: "Shift handover" },
  { id: "escalations", label: "Escalations" },
  { id: "training", label: "Training" },
  { id: "general", label: "General" },
];

const fieldLabelClassName = "text-xs font-medium text-neutral-600";
const inputClassName =
  "mt-1.5 h-10 w-full rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-600 focus:border-neutral-300 focus:bg-white";

type InternalChatEditGroupDialogProps = {
  open: boolean;
  room: InternalChatRoom;
  members: InternalChatMember[];
  currentUserId: string;
  onClose: () => void;
  onSave: (payload: InternalChatUpdateGroupPayload) => void | Promise<void>;
};

export function InternalChatEditGroupDialog({
  open,
  room,
  members,
  currentUserId,
  onClose,
  onSave,
}: InternalChatEditGroupDialogProps) {
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? "");
  const [category, setCategory] = useState<InternalChatGroupCategory | "">(room.category ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(room.avatarUrl ?? null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const avatarInputId = useId();
  const avatarPreviewUrlRef = useRef<string | null>(null);
  const existingAvatarUrl = useAuthenticatedMediaUrl(room.avatarUrl);

  const agents = useMemo(
    () => members.filter((member) => member.userId !== currentUserId && member.role === "member"),
    [members, currentUserId],
  );
  const filteredAgents = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return agents;
    return agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(query) ||
        agent.title?.toLowerCase().includes(query),
    );
  }, [agents, memberSearch]);

  const canSubmit =
    name.trim().length > 0 &&
    description.trim().length >= 10 &&
    category !== "" &&
    selectedIds.length > 0;

  const displayAvatarUrl = removeAvatar ? null : avatarPreviewUrl ?? existingAvatarUrl;

  useEffect(() => {
    if (!open) return;
    setName(room.name);
    setDescription(room.description ?? "");
    setCategory(room.category ?? "");
    setSelectedIds(room.memberIds.filter((memberId) => memberId !== currentUserId));
    setMemberSearch("");
    setAvatarFile(null);
    setRemoveAvatar(false);
    setSaving(false);
    setError(null);
    if (avatarPreviewUrlRef.current) {
      URL.revokeObjectURL(avatarPreviewUrlRef.current);
      avatarPreviewUrlRef.current = null;
    }
    setAvatarPreviewUrl(null);
  }, [currentUserId, open, room]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, saving]);

  if (!open) return null;

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;

    if (avatarPreviewUrlRef.current) {
      URL.revokeObjectURL(avatarPreviewUrlRef.current);
    }

    const nextUrl = URL.createObjectURL(file);
    avatarPreviewUrlRef.current = nextUrl;
    setAvatarPreviewUrl(nextUrl);
    setAvatarFile(file);
    setRemoveAvatar(false);
  }

  function handleRemoveAvatar() {
    if (avatarPreviewUrlRef.current) {
      URL.revokeObjectURL(avatarPreviewUrlRef.current);
      avatarPreviewUrlRef.current = null;
    }
    setAvatarPreviewUrl(null);
    setAvatarFile(null);
    setRemoveAvatar(true);
  }

  function toggleMember(userId: string) {
    setSelectedIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        category: category as InternalChatGroupCategory,
        memberIds: selectedIds,
        avatarFile: avatarFile ?? undefined,
        removeAvatar,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save group changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close dialog"
        onClick={() => {
          if (!saving) onClose();
        }}
      />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="shrink-0 border-b-[0.6px] border-[#bfbfbf] px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">Edit group</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Update the group photo, details, category, and members.
              </p>
            </div>
            <IconButton variant="ghostIcon" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </IconButton>
          </div>
        </div>

        <div className="max-h-[min(70vh,560px)] overflow-y-auto px-6 py-5">
          {error ? (
            <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <div className="space-y-5">
            <div className="flex items-center gap-4 rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/60 p-3.5">
              <div className="relative shrink-0">
                {displayAvatarUrl ? (
                  <img
                    src={displayAvatarUrl}
                    alt=""
                    className="size-14 rounded-full object-cover ring-1 ring-black/5"
                  />
                ) : (
                  <span className="flex size-14 items-center justify-center rounded-full bg-neutral-200 text-neutral-600">
                    <Users className="size-5" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-neutral-900">Group photo</p>
                <p className="mt-0.5 text-sm text-neutral-600">Optional · JPG or PNG</p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <input
                  id={avatarInputId}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleAvatarChange}
                />
                <label
                  htmlFor={avatarInputId}
                  className="inline-flex h-[38px] cursor-pointer items-center gap-1.5 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
                >
                  <Camera className="size-3.5" />
                  Upload
                </label>
                {displayAvatarUrl ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleRemoveAvatar}
                    className="h-[38px]"
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
              <div className="flex h-full min-h-0 flex-col gap-5">
                <label className="block">
                  <span className={fieldLabelClassName}>
                    Group name <span className="text-red-500">*</span>
                  </span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Floor Supervisors"
                    className={inputClassName}
                    autoFocus
                  />
                </label>

                <label className="block">
                  <span className={fieldLabelClassName}>
                    Category <span className="text-red-500">*</span>
                  </span>
                  <select
                    value={category}
                    onChange={(event) =>
                      setCategory(event.target.value as InternalChatGroupCategory | "")
                    }
                    className={cn(inputClassName, category === "" && "text-neutral-400")}
                  >
                    <option value="" disabled>
                      Select a category
                    </option>
                    {GROUP_CATEGORIES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex min-h-0 flex-1 flex-col">
                  <span className={fieldLabelClassName}>
                    Description <span className="text-red-500">*</span>
                  </span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="What is this group for? Include shift, queue, or escalation context."
                    className={cn(
                      inputClassName,
                      "mt-1.5 min-h-[10.5rem] flex-1 resize-none py-2.5 leading-relaxed",
                    )}
                  />
                </label>
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className={fieldLabelClassName}>
                    Members <span className="text-red-500">*</span>
                  </span>
                  <span className="text-[11px] text-neutral-400">
                    {selectedIds.length} selected
                  </span>
                </div>

                <div className="mt-1.5 flex min-h-0 flex-1 flex-col rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/40 p-3">
                  <div className="relative shrink-0">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-neutral-400" />
                    <input
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                      placeholder="Search agents…"
                      className="h-10 w-full rounded-xl border-[0.6px] border-[#bfbfbf] bg-white pr-3 pl-9 text-sm text-neutral-900 outline-none placeholder:text-neutral-600 focus:border-neutral-300"
                    />
                  </div>

                  <ul className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg bg-white p-1">
                    {filteredAgents.length === 0 ? (
                      <li className="px-3 py-8 text-center text-sm text-neutral-600">
                        No agents found
                      </li>
                    ) : (
                      filteredAgents.map((agent) => {
                        const checked = selectedIds.includes(agent.userId);
                        return (
                          <li key={agent.userId} className={listRowDividerClassName()}>
                            <button
                              type="button"
                              onClick={() => toggleMember(agent.userId)}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition",
                                checked ? "bg-neutral-100" : "hover:bg-neutral-50",
                              )}
                            >
                              <span
                                className={profileAvatarClassName(agent.name, "size-8 text-[10px]")}
                                aria-hidden
                              >
                                {profileInitials(agent.name)}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-neutral-900">
                                  {agent.name}
                                </span>
                                {agent.title ? (
                                  <span className="block truncate text-xs text-neutral-600">
                                    {agent.title}
                                  </span>
                                ) : null}
                              </span>
                              <span
                                className={cn(
                                  "flex size-4 shrink-0 items-center justify-center rounded border text-[10px]",
                                  checked
                                    ? "border-neutral-900 bg-neutral-900 text-white"
                                    : "border-neutral-300 bg-white",
                                )}
                                aria-hidden
                              >
                                {checked ? "✓" : null}
                              </span>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t-[0.6px] border-[#bfbfbf] px-6 py-4">
          <p className="text-xs text-neutral-600">
            <span className="text-red-500">*</span> Required fields
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="h-9" disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || saving} className="h-9">
              {saving ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
