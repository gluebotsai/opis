import { segmentTabClassName } from "@/components/ui/button";

export type QueueModuleTab = "queue" | "routing";

const QUEUE_MODULE_TABS: Array<{ id: QueueModuleTab; label: string }> = [
  { id: "queue", label: "Queue" },
  { id: "routing", label: "Routing" },
];

export function QueueModuleTabs({
  value,
  onChange,
}: {
  value: QueueModuleTab;
  onChange: (value: QueueModuleTab) => void;
}) {
  return (
    <div className="grid min-w-full grid-cols-2 gap-1">
      {QUEUE_MODULE_TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={segmentTabClassName({
            active: value === item.id,
            className: "w-full whitespace-nowrap",
          })}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
