import { useEffect, useRef, useState } from "react";

import { EMOJI_CATEGORIES } from "@/features/internal-chat/emoji-data";
import { cn } from "@/lib/utils";

type InternalChatEmojiPickerProps = {
  onSelect: (emoji: string) => void;
  onClose?: () => void;
  className?: string;
};

export function InternalChatEmojiPicker({
  onSelect,
  onClose,
  className,
}: InternalChatEmojiPickerProps) {
  const [activeCategoryId, setActiveCategoryId] = useState(EMOJI_CATEGORIES[0]?.id ?? "smileys");
  const panelRef = useRef<HTMLDivElement>(null);

  const activeCategory =
    EMOJI_CATEGORIES.find((category) => category.id === activeCategoryId) ?? EMOJI_CATEGORIES[0]!;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose?.();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className={cn(
        "absolute bottom-full left-0 z-10 mb-2 flex w-[20rem] flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-lg sm:w-[22rem]",
        className,
      )}
    >
      <div className="border-b-[0.6px] border-[#bfbfbf] px-3 py-2">
        <p className="text-xs font-semibold text-neutral-800">{activeCategory.label}</p>
      </div>

      <div className="h-56 overflow-y-auto px-2 py-2 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-300">
        <div className="grid grid-cols-8 gap-0.5">
          {activeCategory.emojis.map((emoji, index) => (
            <button
              key={`${activeCategory.id}-${emoji}-${index}`}
              type="button"
              onClick={() => onSelect(emoji)}
              className="flex size-9 items-center justify-center rounded-lg text-xl transition hover:bg-neutral-100"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-0.5 overflow-x-auto border-t-[0.6px] border-[#bfbfbf] bg-neutral-50/80 px-1 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {EMOJI_CATEGORIES.map((category) => {
          const active = category.id === activeCategoryId;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategoryId(category.id)}
              aria-label={category.label}
              title={category.label}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg text-lg transition",
                active ? "bg-white shadow-sm" : "hover:bg-white/70",
              )}
            >
              {category.icon}
            </button>
          );
        })}
      </div>
    </div>
  );
}
