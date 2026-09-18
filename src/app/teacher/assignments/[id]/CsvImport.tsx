"use client";

import { useRef, useState } from "react";
import { ensureCsrfToken } from "@/app/login/LoginForm";

type InvalidRow = { line: number; loginName: string; seq: string; reason: string };
type Report = {
  total: number;
  validCount: number;
  invalidCount: number;
  invalid: InvalidRow[];
  preview: any[];
};
type Result = { imported: number; updated: number; skipped: number; statRows?: number };

const KIND_LABEL: Record<"submissions" | "grading", string> = {
  submissions: "答题",
  grading: "批改",
};

async function postJson(url: string, body: unknown) {
  const token = await ensureCsrfToken();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": token },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function downloadText(filename: string, text: string) {
  const blob = new Blob(["" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CsvImport({
  assignmentId,
  kind,
  template,
}: {
  assignmentId: string;
  kind: "submissions" | "grading";
  template: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = `/api/assignments/${assignmentId}/import-${kind}`;
  const label = KIND_LABEL[kind];

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) setError("请选择 .csv 文件");
    else if (f.size > 500 * 1024) setError("文件超过 500KB");
    else {
      setError(null);
      setCsv(await f.text());
      setReport(null);
      setResult(null);
    }
  }

  async function preview() {
    if (!csv) return setError("请先选择 CSV 文件");
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson(`${base}/preview`, { csv });
    setBusy(false);
    if (!ok) return setError(data.error ?? "解析失败");
    setReport(data as Report);
  }

  async function commit(onlyValid: boolean) {
    if (!csv) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson(base, { csv, onlyValid });
    setBusy(false);
    if (!ok) {
      if (data.report) setReport(data.report);
      return setError(data.error ?? "导入失败");
    }
    setResult(data as Result);
    setReport(null);
  }

  return (
    <div className="space-y-4">
      {kind === "grading" && (
        <p className="text-sm bg-blue-50 border border-blue-200 text-blue-700 rounded px-3 py-2">
          批改导入要求对应学生该题已有答题记录，请先完成「答题导入」。
        </p>
      )}

      <div className="card p-5 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" className="btn-secondary text-sm" onClick={() => downloadText(`import-${kind}-template.csv`, template)}>
            下载模板
          </button>
          <a className="btn-secondary text-sm" href={`/api/assignments/${assignmentId}/sample-csv?type=${kind}`}>
            下载示例 CSV（本班学生 × 本题，演示用）
          </a>
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">选择 CSV 文件</label>
          <input ref={fileRef} type="file" accept=".csv" onChange={onFile} className="text-sm" />
          {csv && <span className="text-xs text-gray-400 ml-2">已载入 {csv.length} 字符</span>}
        </div>
        <div>
          <button type="button" className="btn-primary" onClick={preview} disabled={busy || !csv}>
            {busy ? "处理中…" : "解析并预览"}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      </div>

      {report && (
        <div className="card p-5 space-y-3">
          <h3 className="font-semibold">预览报告</h3>
          <div className="flex gap-4 text-sm">
            <span>总计 <b>{report.total}</b> 行</span>
            <span className="text-green-700">成功 <b>{report.validCount}</b></span>
            <span className="text-red-600">失败 <b>{report.invalidCount}</b></span>
          </div>

          {report.invalidCount > 0 && (
            <div>
              <p className="text-sm font-medium mb-1">失败明细（最多 50 条）</p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-1">行</th>
                    <th>学生</th>
                    <th>题号</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {report.invalid.map((r, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1">{r.line}</td>
                      <td>{r.loginName || "-"}</td>
                      <td>{r.seq || "-"}</td>
                      <td className="text-red-600">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.validCount > 0 && (
            <details>
              <summary className="text-sm cursor-pointer text-gray-600">
                成功数据预览（前 {Math.min(10, report.validCount)} 行）
              </summary>
              <pre className="text-xs bg-gray-50 border rounded p-2 mt-2 overflow-auto">
                {JSON.stringify(report.preview, null, 2)}
              </pre>
            </details>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" className="btn-primary" onClick={() => commit(true)} disabled={busy}>
              确认导入 {report.validCount} 条成功行
            </button>
            {report.invalidCount === 0 && (
              <button type="button" className="btn-secondary" onClick={() => commit(false)} disabled={busy}>
                全部导入
              </button>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="card p-5 text-sm space-y-1">
          <p className="text-green-700 font-medium">导入完成 ✓</p>
          <p>新增 {result.imported} · 覆盖 {result.updated} · 跳过 {result.skipped}</p>
          {typeof result.statRows === "number" && (
            <p>
              已重算错误分布（{result.statRows} 条统计），
              <a className="text-brand-500 hover:underline" href={`/teacher/assignments/${assignmentId}/stats`}>
                查看统计看板 →
              </a>
            </p>
          )}
          <button
            type="button"
            className="btn-secondary text-sm mt-2"
            onClick={() => {
              setResult(null);
              setCsv("");
              if (fileRef.current) fileRef.current.value = "";
            }}
          >
            再导入一批
          </button>
        </div>
      )}
    </div>
  );
}
