import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';
import { AuthGuard, AdminGuard } from '../auth/auth.guard.js';

@Global()
@Module({ providers: [PrismaService, RedisService, AuthGuard, AdminGuard], exports: [PrismaService, RedisService, AuthGuard, AdminGuard] })
export class CommonModule {}
