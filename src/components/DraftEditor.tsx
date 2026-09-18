"use client";

import { useMemo } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { INITIAL_STATE, type ActionState } from "@/lib/action";
import { saveDraft } from "@/lib/actions/draftReview";

type Cause = { cause: string; count: number; evidence: string };
type Practice = { text: string; rationale: string };

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "保存中…" : "保存修改"}
    </button>
  );
}

export default function DraftEditor({
  draftId,
  baseUpdatedAt,
  initial,
}: {
  draftId: string;
  baseUpdatedAt: number;
  initial: { summary: string; explanation: string; workedExample: string; causes: Cause[]; practice: Practice[] };
}) {
  const action = useMemo(() => saveDraft.bind(null, draftId), [draftId]);
  const [state, formAction] = useFormState<ActionState, FormData>(action, INITIAL_STATE);

  const errors = state.error
    ? state.error
    : null;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="baseUpdatedAt" value={baseUpdatedAt} />
      <input type="hidden" name="errorCauses" value={JSON.stringify(initial.causes)} />
      <input type="hidden" name="practice" value={JSON.stringify(initial.practice)} />

      <div>
        <label className="block text-sm text-gray-600 mb-1">摘要</label>
        <textarea name="summary" defaultValue={initial.summary} rows={2} className="input w-full" maxLength={500} />
      </div>

      <div>
        <label className="block text-sm text-gray-600 mb-1">错因分析（随草稿生成写入，M5 只读预览）</label>
        {initial.causes.length === 0 ? (
          <p className="text-sm text-gray-400">（无）</p>
        ) : (
          <ul className="text-sm space-y-1">
            {initial.causes.map((c, i) => (
              <li key={i} className="text-gray-700">
                · {c.cause} {c.count > 0 && <span className="text-gray-400">（{c.count} 人）</span>}
                {c.evidence && <span className="text-gray-400"> — {c.evidence}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className="block text-sm text-gray-600 mb-1">分步讲解</label>
        <textarea name="explanation" defaultValue={initial.explanation} rows={8} className="input w-full font-mono text-sm" maxLength={8000} />
      </div>

      <div>
        <label className="block text-sm text-gray-600 mb-1">示例演示（可选）</label>
        <textarea name="workedExample" defaultValue={initial.workedExample} rows={4} className="input w-full font-mono text-sm" maxLength={4000} />
      </div>

      <div>
        <label className="block text-sm text-gray-600 mb-1">候选练习（只读预览）</label>
        {initial.practice.length === 0 ? (
          <p className="text-sm text-gray-400">（无）</p>
        ) : (
          <ul className="text-sm space-y-1">
            {initial.practice.map((p, i) => (
              <li key={i} className="text-gray-700">
                · {p.text} {p.rationale && <span className="text-gray-400">— {p.rationale}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {errors && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{errors}</p>
      )}
      {state.message && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{state.message}</p>
      )}

      <div>
        <SubmitBtn />
      </div>
    </form>
  );
}
