import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { PrismaService } from '../common/prisma.service.js';
import { apiError } from '../common/errors.js';
import { hashToken } from './auth.guard.js';
import type { AuthUser } from './auth.types.js';

export function verificationRequired() { return process.env.EMAIL_VERIFICATION_REQUIRED === 'true' || (process.env.EMAIL_VERIFICATION_REQUIRED !== 'false' && process.env.NODE_ENV === 'production'); }
export function publicUser(user: AuthUser) { return { id: user.id, email: user.email, role: user.role, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null }; }

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async createSession(userId: string) {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({ data: { userId, tokenHash: hashToken(token), csrfToken, expiresAt } });
    // Opportunistic cleanup keeps the local store bounded without a cron dependency.
    await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return { token, csrfToken, expiresAt };
  }

  private checkMailConfig() {
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) throw apiError(503, 'EMAIL_NOT_CONFIGURED', '已开启邮箱验证，但邮件服务尚未配置');
  }

  private async sendVerification(userId: string, email: string) {
    this.checkMailConfig();
    const token = randomBytes(32).toString('base64url');
    const verification = await this.prisma.emailVerification.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    const link = `${new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin}/verify-email?token=${encodeURIComponent(token)}`;
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined, connectionTimeout: 10_000, socketTimeout: 15_000 });
    try {
      await transporter.sendMail({ from: process.env.SMTP_FROM, to: email, subject: '验证你的简历工坊邮箱', text: `请在 30 分钟内打开链接验证邮箱：${link}\n如果不是你本人操作，请忽略本邮件。` });
    } catch {
      await this.prisma.emailVerification.deleteMany({ where: { id: verification.id } });
      throw apiError(502, 'EMAIL_SEND_FAILED', '验证邮件发送失败，请稍后重试');
    } finally { transporter.close(); }
  }

  async register(email: string, password: string) {
    if (verificationRequired()) this.checkMailConfig();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw apiError(409, 'EMAIL_EXISTS', '该邮箱已注册');
    const user = await this.prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: null } });
    if (verificationRequired()) {
      try { await this.sendVerification(user.id, user.email); }
      catch (error) { await this.prisma.user.delete({ where: { id: user.id } }); throw error; }
    }
    return { user: publicUser(user), verificationRequired: verificationRequired(), ...await this.createSession(user.id) };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // The fixed valid hash keeps missing-account requests on the password comparison path.
    const dummy = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6Ttx0YSYlX4L4U6CLJR/ZuW8U9V.K';
    const valid = await bcrypt.compare(password, user?.passwordHash || dummy);
    if (!user || !valid) throw apiError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误');
    return { user: publicUser(user), verificationRequired: verificationRequired() && !user.emailVerifiedAt, ...await this.createSession(user.id) };
  }

  async verifyEmail(token: string) {
    const verification = await this.prisma.emailVerification.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!verification || verification.expiresAt.getTime() <= Date.now()) throw apiError(400, 'VERIFICATION_EXPIRED', '验证链接无效或已过期');
    await this.prisma.$transaction(async tx => {
      const consumed = await tx.emailVerification.deleteMany({ where: { id: verification.id, expiresAt: { gt: new Date() } } });
      if (consumed.count !== 1) throw apiError(400, 'VERIFICATION_EXPIRED', '验证链接无效或已过期');
      await tx.user.update({ where: { id: verification.userId }, data: { emailVerifiedAt: new Date() } });
      await tx.emailVerification.deleteMany({ where: { userId: verification.userId } });
    });
    return { verified: true };
  }

  async resendVerification(user: AuthUser) {
    if (user.emailVerifiedAt) return { sent: false, verified: true };
    await this.sendVerification(user.id, user.email);
    return { sent: true };
  }
}
