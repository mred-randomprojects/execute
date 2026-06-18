import { useState } from "react";
import type { RefObject } from "react";

export function CaptureBar({
  inputRef,
  placeholder,
  onAdd,
  onArrowDown,
}: {
  inputRef: RefObject<HTMLInputElement>;
  placeholder: string;
  onAdd: (raw: string) => void;
  onArrowDown: () => void;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center gap-3 rounded border border-line bg-surface px-3 py-2 shadow-soft focus-within:border-line-strong">
      <span className="text-lg leading-none text-ink-faint">+</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const raw = value;
            setValue("");
            if (raw.trim() !== "") onAdd(raw);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setValue("");
            inputRef.current?.blur();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            inputRef.current?.blur();
            onArrowDown();
          }
        }}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
      />
      <span className="kbd hidden sm:inline">↵</span>
    </div>
  );
}
