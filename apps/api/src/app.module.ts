import { Controller, Get, Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ResumeModule } from './resume/resume.module.js';
import { AiModule } from './ai/ai.module.js';
import { PdfModule } from './pdf/pdf.module.js';
import { TemplateModule } from './template/template.module.js';
import { AdminModule } from './admin/admin.module.js';

@Controller('health')
class HealthController { @Get() health() { return { status: 'ok' }; } }

@Module({ imports: [CommonModule, AuthModule, ResumeModule, AiModule, PdfModule, TemplateModule, AdminModule], controllers: [HealthController] })
export class AppModule {}
