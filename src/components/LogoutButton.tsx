"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="btn-secondary text-sm"
      onClick={async () => {
        const csrf = document.cookie
          .split("; ")
          .find((c) => c.startsWith("csrf="))
          ?.slice(5);
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: csrf ? { "x-csrf-token": csrf } : {},
        });
        router.replace("/login");
        router.refresh();
      }}
    >
      退出登录
    </button>
  );
}
