import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "TEACHER") redirect("/teacher/dashboard");
  if (user.role === "STUDENT") redirect("/student/dashboard");
  if (user.role === "RESEARCHER") redirect("/researcher/dashboard");
  redirect("/login");
}
