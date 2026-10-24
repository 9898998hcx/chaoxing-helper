import { Module } from '@nestjs/common';
import { CrawlerModule } from '../crawler/crawler.module.ts';
import { AdminController } from './admin.controller.ts';
@Module({ imports: [CrawlerModule], controllers: [AdminController] })
export class AdminModule {}
