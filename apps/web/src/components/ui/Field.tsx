"use client";

import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

const inputClasses =
  "w-full rounded-md border-2 border-line bg-raised px-3 py-2 text-fg placeholder:text-muted focus:border-primary aria-[invalid=true]:border-danger";

export function TextField({
  label,
  error,
  hint,
  className,
  ...rest
}: { label: string; error?: string | null; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-heading text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        className={inputClasses}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...rest}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  label,
  error,
  hint,
  className,
  counter,
  focusOnMount,
  ...rest
}: { label: string; error?: string | null; hint?: string; counter?: ReactNode; focusOnMount?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  // Used when the user just asked for the field (e.g. clicked "Reply"); not a page-load autofocus.
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between">
        <label htmlFor={id} className="font-heading text-sm font-medium">
          {label}
        </label>
        {counter && <span className="text-xs text-muted">{counter}</span>}
      </div>
      <textarea
        ref={ref}
        id={id}
        className={cx(inputClasses, "min-h-24 resize-y")}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...rest}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export { inputClasses };
