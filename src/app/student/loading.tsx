import PageLoading from "@/components/PageLoading";

export default function StudentLoading() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      <PageLoading label="正在加载我的错题…" />
    </div>
  );
}
