import { redirect } from "next/navigation";
import Link from "next/link";
import {
  requireRole,
  assertTeacherOwnsAssignment,
  AuthError,
} from "@/lib/auth-guard";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import CsvImport from "../CsvImport";
import { GRADING_TEMPLATE } from "@/lib/csv";

export const dynamic = "force-dynamic";

export default async function ImportGrading({ params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireRole("TEACHER");
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }
  if (user.mustChangePassword) redirect("/account/change-password");

  let assignment;
  try {
    assignment = await assertTeacherOwnsAssignment(user, params.id);
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }

  return (
    <AppShell title="导入批改">
      <div className="mb-4 text-sm">
        <Link href={`/teacher/assignments/${assignment.id}`} className="text-brand-500 hover:underline">
          ← 返回 {assignment.title}
        </Link>
      </div>
      <div className="max-w-2xl">
        <CsvImport assignmentId={assignment.id} kind="grading" template={GRADING_TEMPLATE} />
      </div>
    </AppShell>
  );
}
