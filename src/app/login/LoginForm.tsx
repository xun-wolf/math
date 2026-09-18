"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type QuickAccount = { loginName: string; label: string };

export function readCsrfCookie(): string {
  const m = document.cookie.split("; ").find((c) => c.startsWith("csrf="));
  return m ? decodeURIComponent(m.slice(5)) : "";
}

export async function ensureCsrfToken(): Promise<string> {
  const existing = readCsrfCookie();
  if (existing) return existing;
  const res = await fetch("/api/auth/csrf");
  const data = await res.json();
  return data.token as string;
}

export default function LoginForm({
  csrfToken,
  quickAccounts,
  next,
}: {
  csrfToken: string;
  quickAccounts: QuickAccount[];
  next?: string;
}) {
  const router = useRouter();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(csrfToken);

  useEffect(() => {
    if (!token) ensureCsrfToken().then(setToken);
  }, [token]);

  async function submit(name: string, pw: string) {
    setLoading(true);
    setError(null);
    try {
      const t = token || (await ensureCsrfToken());
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": t,
        },
        body: JSON.stringify({ loginName: name, password: pw }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "登录失败");
        return;
      }
      router.replace(next && next.startsWith("/") ? next : data.redirectTo ?? "/");
      router.refresh();
    } catch (e) {
      setError("网络错误：" + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(loginName, password);
      }}
      className="space-y-4"
    >
      <label className="block">
        <span className="text-sm text-gray-600">账号</span>
        <input
          className="input mt-1"
          value={loginName}
          onChange={(e) => setLoginName(e.target.value)}
          autoComplete="username"
          required
        />
      </label>
      <label className="block">
        <span className="text-sm text-gray-600">密码</span>
        <input
          className="input mt-1"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading ? "登录中…" : "登 录"}
      </button>

      {quickAccounts.length > 0 && (
        <div className="pt-4 border-t border-gray-200">
          <div className="text-xs text-gray-500 mb-2">开发模式快速登录（DEMO_MODE=true）</div>
          <div className="grid grid-cols-2 gap-2">
            {quickAccounts.map((a) => (
              <button
                type="button"
                key={a.loginName}
                disabled={loading}
                className="btn-secondary text-sm"
                onClick={() => submit(a.loginName, "Demo@2026")}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
