"use client";

import { useRef } from "react";
import { useFormState } from "react-dom";
import { INITIAL_STATE } from "@/lib/action";
import {
  resolveCorrection,
  markStillWrong,
  aiCorrectionAdvice,
} from "@/lib/actions/corrections";

export default function CorrectionActions({ correctionId }: { correctionId: string }) {
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [rs, resolve] = useFormState(resolveCorrection.bind(null, correctionId), INITIAL_STATE);
  const [ws, wrong] = useFormState(markStillWrong.bind(null, correctionId), INITIAL_STATE);
  const [as, advice] = useFormState(aiCorrectionAdvice.bind(null, correctionId), INITIAL_STATE);
  const msgs = [rs, ws, as];

  return (
    <form action={resolve}>
      <textarea
        ref={noteRef}
        name="note"
        rows={2}
        placeholder="复核说明（确认掌握可留空；仍需订正必填）"
        className="input w-full text-sm"
      />
      {msgs.map((s, i) =>
        s.message || s.error ? (
          <div key={i} className="text-sm mt-1">
            {s.message && <span className="text-green-700">{s.message}</span>}
            {s.error && <span className="text-red-600">{s.error}</span>}
          </div>
        ) : null
      )}
      {as.data && (
        <div className="mt-2 text-sm bg-blue-50 border border-blue-200 rounded p-3">
          <div className="whitespace-pre-wrap text-gray-800">{as.data}</div>
          <button
            type="button"
            className="btn-secondary text-xs mt-2"
            onClick={() => {
              if (noteRef.current) noteRef.current.value = as.data as string;
            }}
          >
            填入复核说明
          </button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="submit" formAction={resolve} className="btn-primary text-sm">
          确认掌握
        </button>
        <button type="submit" formAction={wrong} className="btn-secondary text-sm">
          仍需订正
        </button>
        <button type="submit" formAction={advice} className="btn-secondary text-sm">
          ✨ AI 点评建议
        </button>
      </div>
    </form>
  );
}
