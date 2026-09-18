import AppShell from "@/components/AppShell";
import { requireUser } from "@/lib/auth-guard";
import ChangePasswordForm from "./ChangePasswordForm";

export default async function ChangePasswordPage() {
  const user = await requireUser();
  return (
    <AppShell title="修改密码">
      <div className="card p-6 max-w-md">
        {user.mustChangePassword && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mb-4">
            首次登录或使用初始密码，请修改密码后继续使用。
          </p>
        )}
        <ChangePasswordForm csrfToken={"" /* 从 cookie 读取 */} />
      </div>
    </AppShell>
  );
}
