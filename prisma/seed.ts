import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const sectionOrder = ['basic', 'intent', 'education', 'work', 'projects', 'skills', 'certificates', 'summary'];
const originals = [
  { slug: 'clean', title: '清晰起点', description: '原创单栏结构，以教育与项目呈现成长路径，适合应届生与初入职场者。', tags: ['应届生', '清爽', '单栏'], style: 'minimal', layout: 'single-column', sectionOrder },
  { slug: 'professional', title: '专业履历', description: '原创职业履历结构，先呈现工作成果与项目经验，适合有经验的求职者。', tags: ['职场', '专业', '技术'], style: 'professional', layout: 'single-column', sectionOrder: ['basic', 'intent', 'work', 'projects', 'skills', 'education', 'certificates', 'summary'] },
  { slug: 'compact', title: '精炼表达', description: '原创紧凑结构，突出核心技能与关键经历，适合技术与产品方向。', tags: ['技术', '产品', '紧凑'], style: 'compact', layout: 'single-column', sectionOrder: ['basic', 'intent', 'skills', 'work', 'projects', 'education', 'certificates', 'summary'] },
];

async function main() {
  for (const template of originals) {
    await prisma.template.upsert({ where: { slug: template.slug }, create: { ...template, status: 'APPROVED', license: '项目原创模板，可自由参考结构' }, update: {} });
  }
  console.log('已准备 3 个原创模板；未启用任何第三方采集来源。');
}

main().catch(() => { console.error('模板初始化失败，请检查数据库配置与迁移。'); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
