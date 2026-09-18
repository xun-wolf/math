"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/types";

const LINKS: Record<Role, { href: string; label: string }[]> = {
  TEACHER: [
    { href: "/teacher/dashboard", label: "工作台" },
    { href: "/teacher/assignments/new", label: "布置作业" },
    { href: "/teacher/knowledge-points", label: "知识点" },
  ],
  STUDENT: [{ href: "/student/dashboard", label: "我的主页" }],
  RESEARCHER: [
    { href: "/researcher/dashboard", label: "工作台" },
    { href: "/teacher/knowledge-points", label: "知识点树" },
  ],
};

export default function Nav({ role }: { role: Role }) {
  const pathname = usePathname();
  const links = LINKS[role] ?? [];
  return (
    <nav className="border-t border-gray-100 bg-white">
      <div className="max-w-6xl mx-auto px-6 flex gap-4 text-sm">
        {links.map((l) => {
          const active =
            pathname === l.href ||
            (l.href !== "/teacher/dashboard" &&
              l.href !== "/researcher/dashboard" &&
              pathname.startsWith(l.href.replace("/new", "")));
          return (
            <Link
              key={l.href}
              href={l.href}
              className={
                "py-2 border-b-2 " +
                (active
                  ? "border-brand-500 text-brand-700 font-medium"
                  : "border-transparent text-gray-500 hover:text-gray-800")
              }
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
