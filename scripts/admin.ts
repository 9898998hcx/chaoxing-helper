import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('用法：npm run admin -- 已注册邮箱');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('请先通过注册页面创建此账号。');
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } }),
    prisma.auditLog.create({ data: { actorId: user.id, action: 'ADMIN_ROLE_GRANTED_LOCAL_CLI', targetType: 'User', targetId: user.id } }),
  ]);
  console.log('管理员角色已授予指定账号。');
}
main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
