"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ChangePasswordForm({ csrfToken: _ignored }: { csrfToken: string }) {
  const router = useRouter();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newPassword !== confirm) {
      setMsg({ kind: "err", text: "两次输入的新密码不一致" });
      return;
    }
    const csrf = document.cookie
      .split("; ")
      .find((c) => c.startsWith("csrf="))
      ?.slice(5);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "修改失败" });
      } else {
        setMsg({ kind: "ok", text: "密码已修改，正在跳转…" });
        setTimeout(() => {
          router.replace("/");
          router.refresh();
        }, 800);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="text-sm text-gray-600">原密码</span>
        <input
          className="input mt-1"
          type="password"
          value={oldPassword}
          onChange={(e) => setOld(e.target.value)}
          required
          autoComplete="current-password"
        />
      </label>
      <label className="block">
        <span className="text-sm text-gray-600">新密码（≥8 位，含大小写与数字）</span>
        <input
          className="input mt-1"
          type="password"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
          required
          autoComplete="new-password"
        />
      </label>
      <label className="block">
        <span className="text-sm text-gray-600">确认新密码</span>
        <input
          className="input mt-1"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
        />
      </label>
      {msg && (
        <div className={msg.kind === "ok" ? "text-sm text-green-700" : "text-sm text-red-600"}>
          {msg.text}
        </div>
      )}
      <button className="btn-primary w-full" disabled={loading}>
        {loading ? "提交中…" : "保存新密码"}
      </button>
    </form>
  );
}
