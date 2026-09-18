"use client";

import { useFormState, useFormStatus } from "react-dom";
import { INITIAL_STATE } from "@/lib/action";
import { replyStudentQuestion } from "@/lib/actions/corrections";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary text-sm">
      {pending ? "提交中…" : "提交回复"}
    </button>
  );
}

export default function QuestionReply({ sqId }: { sqId: string }) {
  const [state, action] = useFormState(replyStudentQuestion.bind(null, sqId), INITIAL_STATE);
  return (
    <form action={action}>
      <textarea
        name="reply"
        rows={2}
        placeholder="给学生讲解这个疑问…"
        className="input w-full text-sm"
      />
      {state.message && <div className="text-sm text-green-700 mt-1">{state.message}</div>}
      {state.error && <div className="text-sm text-red-600 mt-1">{state.error}</div>}
      <div className="mt-2">
        <Submit />
      </div>
    </form>
  );
}
