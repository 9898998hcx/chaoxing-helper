import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../common/prisma.service.js';
import { apiError } from '../common/errors.js';
import type { AuthRequest } from './auth.types.js';

export const SESSION_COOKIE = 'resume_session';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function checkOrigin(origin: string | undefined) {
  const allowed = new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin;
  if (!origin || origin !== allowed) throw apiError(403, 'ORIGIN_FORBIDDEN', '请求来源不受信任');
}
export function verifyCsrf(actual: string | undefined, expected: string) {
  if (!actual || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw apiError(403, 'CSRF_INVALID', '安全令牌无效，请刷新页面后重试');
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = request.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) throw apiError(401, 'UNAUTHENTICATED', '请先登录');
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!session || session.expiresAt.getTime() <= Date.now()) throw apiError(401, 'SESSION_EXPIRED', '登录已过期，请重新登录');
    request.user = { id: session.user.id, email: session.user.email, role: session.user.role, emailVerifiedAt: session.user.emailVerifiedAt };
    request.session = { id: session.id, csrfToken: session.csrfToken };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      checkOrigin(request.get('origin'));
      verifyCsrf(request.get('x-csrf-token'), session.csrfToken);
    }
    const requireVerified = process.env.EMAIL_VERIFICATION_REQUIRED === 'true' || (process.env.NODE_ENV === 'production' && process.env.EMAIL_VERIFICATION_REQUIRED !== 'false');
    if (requireVerified && !session.user.emailVerifiedAt && !request.originalUrl.startsWith('/api/auth/')) throw apiError(403, 'EMAIL_NOT_VERIFIED', '请先验证邮箱');
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (request.user?.role !== 'ADMIN') throw apiError(403, 'FORBIDDEN', '需要管理员权限');
    return true;
  }
}
