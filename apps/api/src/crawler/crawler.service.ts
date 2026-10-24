import { Injectable, Inject, NotFoundException, ServiceUnavailableException, BadRequestException, ConflictException, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service.ts';
import { RedisService } from '../common/redis.service.ts';

@Injectable()
export class CrawlerService implements OnModuleDestroy {
  private queue?: Queue;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(RedisService) private readonly redis: RedisService) {}
  async trigger(sourceId: string, actorId: string) {
    if (process.env.CRAWLER_ENABLED !== 'true') throw new ServiceUnavailableException({ code: 'CRAWLER_DISABLED', message: '爬虫默认关闭，请先确认来源授权与部署条件' });
    if (!process.env.REDIS_URL || process.env.REDIS_URL.startsWith('memory:')) throw new ServiceUnavailableException({ code: 'CRAWLER_REDIS_REQUIRED', message: '爬虫队列需要独立 Redis 服务' });
    const source = await this.prisma.templateSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new NotFoundException({ code: 'SOURCE_NOT_FOUND', message: '来源不存在' });
    if (!source.enabled || !source.permissionConfirmed || !source.tosEvidence?.trim() || !source.metadataPath || !source.robotsRequired) throw new BadRequestException({ code: 'SOURCE_NOT_AUTHORIZED', message: '来源须启用、记录公开采集授权依据、配置元数据路径，并检查 robots.txt' });
    const pending = await this.prisma.crawlJob.findFirst({ where: { sourceId, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (pending) throw new ConflictException({ code: 'CRAWL_ALREADY_PENDING', message: '此来源已有排队或执行中的任务' });
    await this.redis.consume(`crawl-trigger:${actorId}`, 3, 60);
    const job = await this.prisma.crawlJob.create({ data: { sourceId, status: 'QUEUED' } });
    try {
      await this.redis.connect();
      this.queue ??= new Queue('template-crawl', { connection: this.redis.client as any });
      await this.queue.add('crawl', { jobId: job.id, sourceId }, { jobId: job.id, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
      await this.prisma.auditLog.create({ data: { actorId, action: 'CRAWL_TRIGGER', targetType: 'TemplateSource', targetId: sourceId, metadata: { jobId: job.id } } });
      return { job };
    } catch {
      await this.prisma.crawlJob.update({ where: { id: job.id }, data: { status: 'FAILED', reason: 'QUEUE_UNAVAILABLE', finishedAt: new Date() } });
      throw new ServiceUnavailableException({ code: 'CRAWL_QUEUE_UNAVAILABLE', message: '爬虫队列暂不可用' });
    }
  }
  async onModuleDestroy() { await this.queue?.close(); }
}
