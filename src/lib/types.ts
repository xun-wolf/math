export const ROLES = ["TEACHER", "STUDENT", "RESEARCHER"] as const;
export type Role = (typeof ROLES)[number];

export const HOME_BY_ROLE: Record<Role, string> = {
  TEACHER: "/teacher/dashboard",
  STUDENT: "/student/dashboard",
  RESEARCHER: "/researcher/dashboard",
};
