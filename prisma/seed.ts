import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const COST = process.env.NODE_ENV === "production" ? 12 : 10;
const INITIAL_PWD = "Demo@2026";

async function main() {
  console.log("→ 清空数据");
  await prisma.auditLog.deleteMany();
  await prisma.loginAudit.deleteMany();
  await prisma.session.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.classRoom.deleteMany();
  await prisma.knowledgePoint.deleteMany();
  await prisma.user.deleteMany();

  console.log(`→ 生成密码哈希 (cost=${COST})…`);
  const hash = await bcrypt.hash(INITIAL_PWD, COST);

  const teacher01 = await prisma.user.create({
    data: {
      loginName: "teacher01",
      name: "张老师",
      role: "TEACHER",
      passwordHash: hash,
      mustChangePassword: true,
    },
  });
  const teacher02 = await prisma.user.create({
    data: {
      loginName: "teacher02",
      name: "李老师",
      role: "TEACHER",
      passwordHash: hash,
      mustChangePassword: true,
    },
  });
  const researcher = await prisma.user.create({
    data: {
      loginName: "researcher01",
      name: "教研王主任",
      role: "RESEARCHER",
      passwordHash: hash,
      mustChangePassword: true,
    },
  });

  const students: { user: { id: string; loginName: string; name: string } }[] = [];
  for (let i = 1; i <= 45; i++) {
    const loginName = "student" + String(i).padStart(2, "0");
    const name = `学生 ${i} 号`;
    const u = await prisma.user.create({
      data: { loginName, name, role: "STUDENT", passwordHash: hash, mustChangePassword: true },
    });
    students.push({ user: { id: u.id, loginName: u.loginName, name: u.name } });
  }

  const classA = await prisma.classRoom.create({
    data: { name: "初二（3）班", teacherId: teacher01.id },
  });
  const classB = await prisma.classRoom.create({
    data: { name: "初二（4）班", teacherId: teacher02.id },
  });
  await prisma.classEnrollment.createMany({
    data: students.map((s) => ({ classId: classA.id, studentId: s.user.id })),
  });

  const kpMath = await prisma.knowledgePoint.create({
    data: { code: "M-EQ", name: "一元一次方程", subject: "math" },
  });
  await prisma.knowledgePoint.createMany({
    data: [
      { code: "M-EQ-SOLVE", name: "一元一次方程解法", subject: "math", parentId: kpMath.id },
      { code: "M-EQ-SIGN", name: "移项变号", subject: "math", parentId: kpMath.id },
      { code: "M-FRAC-OP", name: "分数运算", subject: "math" },
    ],
  });

  const accountsFile = path.join(process.cwd(), "SEED_ACCOUNTS.md");
  fs.writeFileSync(
    accountsFile,
    [
      "# Seed 演示账号",
      "",
      "> 该文件由 `prisma/seed.ts` 生成，已在 .gitignore 中。生产环境请勿 seed 真实用户。",
      "",
      `- 初始密码（所有账号统一）：\`${INITIAL_PWD}\``,
      `- DEMO_MODE=true 时不强制首次改密；生产环境构建后所有账号首次登录必须改密`,
      "",
      "## 教师",
      "",
      "| loginName | 显示名 |",
      "|---|---|",
      `| teacher01 | 张老师 |`,
      `| teacher02 | 李老师 |`,
      "",
      "## 学生（45 人）",
      "",
      "| loginName | 显示名 |",
      "|---|---|",
      ...students.map((s) => `| ${s.user.loginName} | ${s.user.name} |`),
      "",
      "## 教研",
      "",
      "| loginName | 显示名 |",
      "|---|---|",
      `| researcher01 | ${researcher.name} |`,
      "",
      "## 班级",
      "",
      `- ${classA.name} → 张老师（含全部 45 名学生）`,
      `- ${classB.name} → 李老师（用于跨班越权演示，无学生）`,
      "",
    ].join("\n"),
    "utf-8"
  );

  console.log(`✔ Seed 完成：${students.length} 学生 / 2 教师 / 1 教研 / 2 班级 / 4 知识点`);
  console.log(`✔ 演示账号清单：${accountsFile}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
