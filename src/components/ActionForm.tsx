"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { INITIAL_STATE, type ActionState } from "@/lib/action";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "提交中…" : label}
    </button>
  );
}

export default function ActionForm({
  action,
  submitLabel = "保存",
  children,
  className = "",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
  children?: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useFormState(action, INITIAL_STATE);
  return (
    <form action={formAction} className={className}>
      {children}
      {state.message && (
        <p className="text-sm text-green-700 mt-2 bg-green-50 border border-green-200 rounded px-3 py-2">
          {state.message}
        </p>
      )}
      {state.error && (
        <p className="text-sm text-red-600 mt-2 bg-red-50 border border-red-200 rounded px-3 py-2">
          {state.error}
        </p>
      )}
      <div className="mt-3">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
