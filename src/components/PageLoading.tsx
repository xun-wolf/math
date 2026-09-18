export default function PageLoading({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-gray-500">
        <span
          className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500"
          aria-hidden
        />
        {label}
      </div>
    </div>
  );
}
