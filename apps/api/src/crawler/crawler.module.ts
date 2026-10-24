import { Module } from '@nestjs/common';
import { CrawlerService } from './crawler.service.ts';
@Module({ providers: [CrawlerService], exports: [CrawlerService] })
export class CrawlerModule {}
