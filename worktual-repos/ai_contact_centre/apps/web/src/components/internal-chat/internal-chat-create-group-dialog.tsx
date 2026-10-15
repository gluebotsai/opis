import { Camera, Search, Users, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { listRowDividerClassName } from "@/components/ui/list-row";
import type {
  InternalChatCreateGroupPayload,
  InternalChatGroupCategory,
  InternalChatMember,
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

type InternalChatCreateGroupDialogProps = {
  open: boolean;
  members: InternalChatMember[];
  currentUserId: string;
  onClose: () => void;
  onCreate: (payload: InternalChatCreateGroupPayload) => void;
};

export function InternalChatCreateGroupDialog({
  open,
  members,
  currentUserId,
  onClose,
  onCreate,
}: InternalChatCreateGroupDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<InternalChatGroupCategory | "">("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  const avatarInputId = useId();
  const avatarPreviewUrlRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setCategory("");
    setSelectedIds([]);
    setMemberSearch("");
    if (avatarPreviewUrlRef.current) {
      URL.revokeObjectURL(avatarPreviewUrlRef.current);
      avatarPreviewUrlRef.current = null;
    }
    setAvatarPreviewUrl(null);
    setAvatarFile(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

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
  }

  function handleRemoveAvatar() {
    if (avatarPreviewUrlRef.current) {
      URL.revokeObjectURL(avatarPreviewUrlRef.current);
      avatarPreviewUrlRef.current = null;
    }
    setAvatarPreviewUrl(null);
    setAvatarFile(null);
  }

  function toggleMember(userId: string) {
    setSelectedIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onCreate({
      name: name.trim(),
      description: description.trim(),
      category,
      memberIds: selectedIds,
      avatarFile: avatarFile ?? undefined,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="shrink-0 border-b-[0.6px] border-[#bfbfbf] px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">Create group</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Set up a new internal group with purpose, members, and context for your team.
              </p>
            </div>
            <IconButton variant="ghostIcon" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </IconButton>
          </div>
        </div>

        <div className="max-h-[min(70vh,560px)] overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            <div className="flex items-center gap-4 rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/60 p-3.5">
              <div className="relative shrink-0">
                {avatarPreviewUrl ? (
                  <img
                    src={avatarPreviewUrl}
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
                {avatarPreviewUrl ? (
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
                    Add agents <span className="text-red-500">*</span>
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
            <Button type="button" variant="outline" onClick={onClose} className="h-9">
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="h-9">
              Create group
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
