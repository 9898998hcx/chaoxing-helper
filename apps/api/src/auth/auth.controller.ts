import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService, publicUser } from './auth.service.js';
import { AuthGuard, checkOrigin, hashToken, SESSION_COOKIE } from './auth.guard.js';
import type { AuthRequest } from './auth.types.js';
import { RedisService } from '../common/redis.service.js';
import { PrismaService } from '../common/prisma.service.js';

const credentials = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(10).max(72).refine(v => Buffer.byteLength(v) <= 72, '密码不能超过 72 字节') }).strict();

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(RedisService) private readonly redis: RedisService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async publicLimit(request: Request, route: string) {
    checkOrigin(request.get('origin'));
    await this.redis.consume(`auth:${route}:${request.ip || 'unknown'}`, route === 'register' ? 10 : 25, 15 * 60);
  }

  private cookie(response: Response, result: Awaited<ReturnType<AuthService['login']>>) {
    response.cookie(SESSION_COOKIE, result.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api', expires: result.expiresAt });
    const { token: _token, expiresAt: _expiresAt, ...body } = result;
    return body;
  }

  @Post('register')
  async register(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.publicLimit(request, 'register');
    const input = credentials.parse(body);
    return this.cookie(response, await this.auth.register(input.email, input.password));
  }

  @Post('login')
  async login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.publicLimit(request, 'login');
    const input = credentials.parse(body);
    await this.redis.consume(`auth:account:${hashToken(input.email)}`, 15, 15 * 60);
    return this.cookie(response, await this.auth.login(input.email, input.password));
  }

  @Get('me') @UseGuards(AuthGuard)
  me(@Req() request: AuthRequest) { return { user: publicUser(request.user), csrfToken: request.session.csrfToken }; }

  @Post('logout') @UseGuards(AuthGuard)
  async logout(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    await this.prisma.session.deleteMany({ where: { id: request.session.id, userId: request.user.id } });
    response.clearCookie(SESSION_COOKIE, { path: '/api', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    return { loggedOut: true };
  }

  @Post('verify-email')
  async verify(@Body() body: unknown, @Req() request: Request) {
    await this.publicLimit(request, 'verify');
    return this.auth.verifyEmail(z.object({ token: z.string().min(32).max(128) }).strict().parse(body).token);
  }

  @Post('resend-verification') @UseGuards(AuthGuard)
  async resend(@Req() request: AuthRequest) {
    await this.redis.consume(`auth:resend:${request.user.id}`, 3, 30 * 60);
    return this.auth.resendVerification(request.user);
  }
}
