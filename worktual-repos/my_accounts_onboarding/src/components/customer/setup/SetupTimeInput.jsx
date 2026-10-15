import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

/** Parse typed time into HH:MM (24h). Returns "" for empty, null for invalid. */
export function parseTypedTime(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const cleaned = raw.replace(/\./g, ":").replace(/\s+/g, " ").toUpperCase();

  let match = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!match) {
    match = cleaned.match(/^(\d{1,2})\s*(AM|PM)$/);
    if (match) {
      match = [match[0], match[1], "00", match[2]];
    }
  }
  if (!match) {
    match = cleaned.match(/^(\d{1,2})(\d{2})\s*(AM|PM)?$/);
    if (match) {
      match = [match[0], match[1], match[2], match[3]];
    }
  }
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3] || "";

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "AM") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Time field that supports typing (12h or 24h) and picking from the native clock.
 * Value is always stored as HH:MM (24h) or "".
 */
export function SetupTimeInput({ value = "", onChange, placeholder = "HH:MM or 10:00 AM" }) {
  const pickerRef = useRef(null);
  const [text, setText] = useState(value || "");

  useEffect(() => {
    setText(value || "");
  }, [value]);

  function commit(raw) {
    const parsed = parseTypedTime(raw);
    if (parsed === null) {
      setText(value || "");
      return;
    }
    setText(parsed);
    if (parsed !== (value || "")) {
      onChange(parsed);
    }
  }

  function openPicker() {
    const node = pickerRef.current;
    if (!node) return;
    if (typeof node.showPicker === "function") {
      try {
        node.showPicker();
        return;
      } catch {
        // fall through to click()
      }
    }
    node.click();
  }

  return (
    <div className="setup-time-input">
      <input
        aria-label="Type time"
        className="setup-time-input__text"
        inputMode="text"
        onBlur={() => commit(text)}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(text);
          }
        }}
        placeholder={placeholder}
        type="text"
        value={text}
      />
      <input
        aria-hidden="true"
        className="setup-time-input__picker"
        onChange={(event) => {
          const next = event.target.value || "";
          setText(next);
          onChange(next);
        }}
        ref={pickerRef}
        tabIndex={-1}
        type="time"
        value={value || ""}
      />
      <button
        aria-label="Open time picker"
        className="setup-time-input__clock"
        onClick={openPicker}
        type="button"
      >
        <Clock size={14} />
      </button>
    </div>
  );
}
