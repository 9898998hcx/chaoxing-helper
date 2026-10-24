import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { crawlSource, sourcePermitted } from './engine.ts';
import { safeFetch } from './security.ts';
import { waitForSourceSlot } from './rate-limit.ts';

async function main() {
  if (process.env.CRAWLER_ENABLED !== 'true') { console.info('Template crawler disabled (CRAWLER_ENABLED=false).'); return; }
  if (!process.env.REDIS_URL || process.env.REDIS_URL.startsWith('memory:')) throw new Error('CRAWLER_REDIS_REQUIRED');
  const prisma = new PrismaClient();
  const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue('template-crawl', { connection });
  await queue.setGlobalConcurrency(1);
  const worker = new Worker('template-crawl', async queued => {
    const jobId = String(queued.data.jobId || '');
    const job = await prisma.crawlJob.findUnique({ where: { id: jobId } });
    // BullMQ may recover a stalled task whose database row already says RUNNING.
    if (!job || !['QUEUED', 'RUNNING'].includes(job.status)) return;
    const source = await prisma.templateSource.findUnique({ where: { id: job.sourceId } });
    if (!source) {
      await prisma.crawlJob.update({ where: { id: jobId }, data: { status: 'SKIPPED', reason: 'SOURCE_NOT_FOUND', finishedAt: new Date() } });
      return;
    }
    await prisma.crawlJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });
    const result = await crawlSource(source, {
      fetch: safeFetch,
      isEnabled: () => process.env.CRAWLER_ENABLED === 'true',
      mayProceed: async () => {
        const current = await prisma.templateSource.findUnique({ where: { id: source.id } });
        return !!current && sourcePermitted(current) && current.baseUrl === source.baseUrl && current.metadataPath === source.metadataPath && current.tosUrl === source.tosUrl && current.tosEvidence === source.tosEvidence;
      },
      waitForSlot: (id, delay) => waitForSourceSlot(connection, id, delay),
      store: async (metadata, current) => {
        const latestSource = await prisma.templateSource.findUnique({ where: { id: current.id } });
        if (!latestSource || !sourcePermitted(latestSource)) return false;
        const exists = await prisma.template.findFirst({ where: { OR: [{ sourceUrl: metadata.sourceUrl }, { slug: metadata.slug }] } });
        // Never resurrect a rejected/taken-down item or mutate previously reviewed content.
        if (exists) return false;
        await prisma.template.create({ data: {
          ...metadata, sourceId: current.id, description: '公开结构元数据，仅供参考模块顺序与布局；查看原来源了解授权。', status: 'PENDING',
        } });
        return true;
      },
    });
    await prisma.$transaction([
      prisma.crawlJob.update({ where: { id: jobId }, data: { ...result, finishedAt: new Date() } }),
      prisma.auditLog.create({ data: { action: 'CRAWL_FINISHED', targetType: 'CrawlJob', targetId: jobId, metadata: { status: result.status, reason: result.reason || null, processedCount: result.processedCount } } }),
    ]);
  }, { connection, concurrency: 1, limiter: { max: 1, duration: 3000 } });
  worker.on('error', () => console.error('Template worker connection error; inspect Redis availability.'));
  worker.on('failed', async job => {
    if (job?.data.jobId) await prisma.crawlJob.updateMany({ where: { id: String(job.data.jobId), status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'FAILED', reason: 'WORKER_FAILED', finishedAt: new Date() } }).catch(() => undefined);
  });
  const stop = async () => { await worker.close(); await queue.close(); await connection.quit(); await prisma.$disconnect(); };
  process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
  console.info('Template worker ready; concurrency=1, public metadata only.');
}
main().catch(() => { console.error('Template worker startup failed; check database and Redis configuration.'); process.exitCode = 1; });
