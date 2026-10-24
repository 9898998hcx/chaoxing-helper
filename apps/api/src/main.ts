import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/errors.js';

async function main() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  app.setGlobalPrefix('api');
  app.use(json({ limit: '500kb' }));
  app.use(cookieParser());
  app.use((request: any, response: any, next: () => void) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Cache-Control', 'no-store');
    if (process.env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  // Enable only behind a known reverse proxy; never trust arbitrary forwarded IPs.
  if (process.env.TRUST_PROXY === 'true') app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableCors({ origin: new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin, credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Token'], methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], exposedHeaders: ['Content-Disposition'] });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || process.env.API_PORT || 3001), process.env.API_HOST || '127.0.0.1');
  console.log(`API 已启动，端口 ${Number(process.env.PORT || process.env.API_PORT || 3001)}`);
}

main().catch(() => { console.error('API 启动失败，请检查数据库、端口与环境变量。'); process.exitCode = 1; });
