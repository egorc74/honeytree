"use client";

import { useId, useRef, useState } from "react";
import { cx } from "../ui";

/** Click-or-drag file picker. The visible label is a real <label> over a visually hidden input, so it is keyboard accessible. */
export function FileDrop({
  label,
  hint,
  accept,
  multiple,
  onFiles,
  disabled,
  testId,
}: {
  label: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={cx(
        "flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2",
        over ? "border-primary bg-surface" : "border-line bg-raised hover:border-primary",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <span aria-hidden className="text-3xl">
        🍯
      </span>
      <span className="font-heading text-lg font-semibold">{label}</span>
      <span className="text-sm text-muted">{hint}</span>
      <input
        id={id}
        ref={input}
        data-testid={testId}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onFiles(files);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />
    </label>
  );
}
