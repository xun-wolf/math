"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string; status?: number };
  reset: () => void;
}) {
  const status = error?.status ?? 500;
  const isAuth = status === 401 || status === 403 || status === 404;
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="text-5xl font-bold text-gray-300 mb-2">{status}</div>
        <h1 className="text-lg font-semibold mb-2">
          {isAuth ? "访问被拒绝" : "出错了"}
        </h1>
        <p className="text-sm text-gray-600 mb-6">{error?.message || "未知错误"}</p>
        <div className="flex gap-2 justify-center">
          <a href="/" className="btn-secondary">回首页</a>
          <button onClick={reset} className="btn-primary">重试</button>
        </div>
      </div>
    </main>
  );
}
