import { requireRole, AuthError } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import ActionForm from "@/components/ActionForm";
import {
  createKnowledgePoint,
  updateKnowledgePoint,
  deleteKnowledgePoint,
} from "@/lib/actions/knowledge";

export const dynamic = "force-dynamic";

type KP = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  description: string | null;
  children: KP[];
};

function buildTree(all: { id: string; code: string; name: string; parentId: string | null; description: string | null }[]): KP[] {
  const map = new Map<string, KP>();
  all.forEach((n) => map.set(n.id, { ...n, children: [] }));
  const roots: KP[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) map.get(node.parentId)!.children.push(node);
    else roots.push(node);
  });
  const sortRec = (arr: KP[]) => {
    arr.sort((a, b) => a.code.localeCompare(b.code));
    arr.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function TreeNode({ node, depth, editable }: { node: KP; depth: number; editable: boolean }) {
  return (
    <li>
      <div
        className="py-2 flex flex-col gap-2"
        style={{ paddingLeft: `${depth * 20}px` }}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{node.code}</span>
          <span className="font-medium">{node.name}</span>
          {node.description && (
            <span className="text-xs text-gray-400">— {node.description}</span>
          )}
        </div>
        {editable && (
          <div className="flex items-start gap-6">
            <ActionForm
              action={updateKnowledgePoint.bind(null, node.id)}
              submitLabel="保存"
              className="flex-1"
            >
              <div className="flex gap-2 items-center">
                <input
                  name="name"
                  defaultValue={node.name}
                  className="input text-sm"
                  maxLength={40}
                  required
                />
                <input
                  name="description"
                  defaultValue={node.description ?? ""}
                  className="input text-sm"
                  maxLength={200}
                  placeholder="描述（可选）"
                />
              </div>
            </ActionForm>
            <ActionForm
              action={deleteKnowledgePoint.bind(null, node.id)}
              submitLabel="删除"
            >
              <span className="sr-only">删除该知识点</span>
            </ActionForm>
          </div>
        )}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} editable={editable} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function KnowledgePoints() {
  let user;
  try {
    user = await requireRole("TEACHER", "RESEARCHER");
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden message={e.message} />;
    throw e;
  }

  const all = await prisma.knowledgePoint.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, parentId: true, description: true },
  });
  const tree = buildTree(all);
  const editable = user.role === "RESEARCHER";

  return (
    <AppShell title="知识点树">
      <div className="grid md:grid-cols-3 gap-6">
        <section className="md:col-span-2">
          {!editable && (
            <div className="mb-4 text-sm bg-blue-50 border border-blue-200 text-blue-700 rounded px-3 py-2">
              知识点树由教研负责人维护，教师为只读视图。
              {env.isDemo && "（演示：可用 researcher01 登录进行编辑）"}
            </div>
          )}
          {tree.length === 0 ? (
            <p className="text-sm text-gray-500">暂无知识点。</p>
          ) : (
            <ul className="card p-3">
              {tree.map((n) => (
                <TreeNode key={n.id} node={n} depth={0} editable={editable} />
              ))}
            </ul>
          )}
        </section>

        <aside>
          {editable ? (
            <div className="card p-5">
              <h3 className="font-semibold mb-3">新增知识点</h3>
              <ActionForm action={createKnowledgePoint} submitLabel="添加">
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">编码 *</label>
                    <input name="code" className="input" placeholder="如：EQ-1-2" required maxLength={30} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">名称 *</label>
                    <input name="name" className="input" placeholder="如：移项变号" required maxLength={40} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">父节点</label>
                    <select name="parentId" className="input" defaultValue="">
                      <option value="">（顶级节点）</option>
                      {all.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.code} · {n.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">描述</label>
                    <input name="description" className="input" maxLength={200} placeholder="可选" />
                  </div>
                </div>
              </ActionForm>
            </div>
          ) : (
            <div className="card p-5 text-sm text-gray-500">
              共 {all.length} 个知识点。仅教研负责人可增删改。
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
