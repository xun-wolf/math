export default function Forbidden({
  message = "无权访问",
  code = 403,
}: {
  message?: string;
  code?: 401 | 403 | 404;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="text-5xl font-bold text-gray-300 mb-2">{code}</div>
        <h1 className="text-lg font-semibold mb-2">
          {code === 404 ? "资源不存在" : "访问被拒绝"}
        </h1>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <a href="/" className="btn-primary">回首页</a>
      </div>
    </main>
  );
}
