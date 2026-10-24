import { Module } from '@nestjs/common';
import { TemplateController } from './template.controller.ts';
import { TemplateService } from './template.service.ts';

@Module({ controllers: [TemplateController], providers: [TemplateService], exports: [TemplateService] })
export class TemplateModule {}
