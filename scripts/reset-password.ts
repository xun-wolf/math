import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const [loginName, newPassword] = process.argv.slice(2);
  if (!loginName || !newPassword) {
    console.error("用法：npm run reset-password -- <loginName> <newPassword>");
    process.exit(2);
  }
  const cost = process.env.NODE_ENV === "production" ? 12 : 10;
  const passwordHash = await bcrypt.hash(newPassword, cost);
  const res = await prisma.user.update({
    where: { loginName },
    data: { passwordHash, mustChangePassword: false, failedAttempts: 0, lockedUntil: null },
  });
  const s = await prisma.session.updateMany({
    where: { userId: res.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  console.log(`✔ ${loginName} 密码已重置；撤销 ${s.count} 个会话`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
