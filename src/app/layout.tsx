import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "初中数学作业讲评与错题跟踪助手",
  description: "AI 原生 · 教师批改之后的讲评与订正闭环",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
