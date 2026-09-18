import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const loginName = process.argv[2];
  if (!loginName) {
    console.error("用法：npm run revoke-sessions -- <loginName>");
    process.exit(2);
  }
  const user = await prisma.user.findUnique({ where: { loginName } });
  if (!user) {
    console.error("用户不存在：" + loginName);
    process.exit(1);
  }
  const res = await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  console.log(`✔ 撤销 ${loginName} 的 ${res.count} 个会话`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
