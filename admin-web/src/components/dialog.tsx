"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  /** Optional text/number field shown in the dialog (e.g. reason, volume count). */
  input?: { label: string; placeholder?: string; type?: "text" | "number"; required?: boolean; initial?: string };
}

export interface ConfirmResult {
  ok: boolean;
  value: string;
}

function ConfirmDialog({ opts, onClose }: { opts: ConfirmOptions; onClose: (r: ConfirmResult) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(opts.input?.initial ?? "");

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const invalid = !!opts.input?.required && value.trim() === "";
  const confirmCls = opts.tone === "danger"
    ? "bg-red-700 text-white hover:bg-red-800 focus-visible:outline-red-700"
    : "bg-orange-600 text-white hover:bg-orange-700 focus-visible:outline-orange-600";

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose({ ok: false, value: "" });
      }}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/50"
    >
      <form
        method="dialog"
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) onClose({ ok: true, value: value.trim() });
        }}
      >
        <h2 id="confirm-title" className="text-base font-semibold">{opts.title}</h2>
        <div className="mt-2 text-sm text-slate-600">{opts.message}</div>
        {opts.input && (
          <label className="mt-4 block text-sm font-medium text-slate-700">
            {opts.input.label}
            <input
              autoFocus
              type={opts.input.type ?? "text"}
              inputMode={opts.input.type === "number" ? "numeric" : undefined}
              value={value}
              placeholder={opts.input.placeholder}
              onChange={(e) => setValue(e.target.value)}
              className="mt-1 block h-11 w-full rounded-md border border-slate-300 px-3 text-base focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30"
            />
          </label>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => onClose({ ok: false, value: "" })}
            className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
          >
            {opts.cancelLabel ?? "Cancelar"}
          </button>
          <button
            type="submit"
            autoFocus={!opts.input}
            disabled={invalid}
            className={`h-11 rounded-md px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 ${confirmCls}`}
          >
            {opts.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Promise-based confirmation dialog (replaces window.confirm/prompt). Render `dialog` in the component tree. */
export function useConfirm() {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (r: ConfirmResult) => void } | null>(null);
  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<ConfirmResult>((resolve) => setState({ opts, resolve })),
    [],
  );
  const dialog = state ? (
    <ConfirmDialog
      opts={state.opts}
      onClose={(r) => {
        state.resolve(r);
        setState(null);
      }}
    />
  ) : null;
  return { confirm, dialog };
}
