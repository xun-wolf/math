import { NextResponse } from "next/server";
import { guardTeacherAssignment, readCsvBody, buildImportContext, report } from "@/lib/import-api";
import { validateGrading } from "@/lib/csv";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guardTeacherAssignment(req, params.id, true);
  if ("err" in g) return g.err;
  const b = await readCsvBody(req);
  if ("err" in b) return b.err;
  const ctx = await buildImportContext(params.id, true);
  const { valid, invalid } = validateGrading(b.csv, ctx);
  return NextResponse.json(report(valid, invalid));
}
