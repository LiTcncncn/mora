"use client";

import { useState, type ReactNode } from "react";

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-base font-medium">{children}</h2>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-medium">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--color-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  /** warning 用于「允许继续但必须让人看见」的情形，例如配置降级。 */
  tone?: "info" | "warning" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded border px-3 py-2 text-sm ${
        tone === "error"
          ? "border-[var(--color-danger)] text-[var(--color-danger)]"
          : tone === "warning"
            ? "border-[var(--color-warning)] text-[var(--color-warning)]"
            : "text-[var(--color-muted)]"
      }`}
    >
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-dashed px-4 py-8 text-center text-sm text-[var(--color-muted)]">
      {children}
    </div>
  );
}

export function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="text-[var(--color-muted)]">{open ? "收起" : "展开"}</span>
      </button>
      {open ? <div className="border-t p-3">{children}</div> : null}
    </div>
  );
}

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = "btn",
  disabled = false,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed || disabled) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn text-[var(--color-danger)]"
        onClick={async () => {
          setArmed(false);
          await onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn" onClick={() => setArmed(false)}>
        取消
      </button>
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? (
        <span className="mt-1 block text-xs text-[var(--color-muted)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
