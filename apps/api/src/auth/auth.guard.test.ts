import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard, AdminGuard, checkOrigin, hashToken, verifyCsrf } from './auth.guard.js';

const context = (request: any) => ({ switchToHttp: () => ({ getRequest: () => request }) }) as any;
const user = { id: 'owner', email: 'owner@example.com', role: 'USER', emailVerifiedAt: new Date() };
const token = 'a'.repeat(43);

afterEach(() => { vi.unstubAllEnvs(); });
describe('Session and CSRF boundaries', () => {
  it('hashes session secrets before querying and rejects expired sessions', async () => {
    const findUnique = vi.fn().mockResolvedValue({ user, expiresAt: new Date(0), csrfToken: 'csrf' });
    const guard = new AuthGuard({ session: { findUnique } } as any);
    await expect(guard.canActivate(context({ cookies: { resume_session: token }, method: 'GET' }))).rejects.toMatchObject({ status: 401 });
    expect(findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    expect(hashToken(token)).not.toBe(token);
  });

  it('rejects cross-origin mutations and a wrong CSRF token', async () => {
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
    const guard = new AuthGuard({ session: { findUnique: vi.fn().mockResolvedValue({ id: 'session', user, expiresAt: new Date(Date.now() + 60_000), csrfToken: 'expected' }) } } as any);
    const request = { cookies: { resume_session: token }, method: 'PATCH', originalUrl: '/api/resumes/id', get: (key: string): string => key === 'origin' ? 'https://evil.example' : 'expected' };
    await expect(guard.canActivate(context(request))).rejects.toMatchObject({ status: 403 });
    request.get = (key: string) => key === 'origin' ? 'http://localhost:3000' : 'wrong';
    await expect(guard.canActivate(context(request))).rejects.toMatchObject({ status: 403 });
  });

  it('binds identity to the database session and gates unverified accounts when configured', async () => {
    vi.stubEnv('EMAIL_VERIFICATION_REQUIRED', 'true');
    const guard = new AuthGuard({ session: { findUnique: vi.fn().mockResolvedValue({ id: 'session', user: { ...user, emailVerifiedAt: null }, expiresAt: new Date(Date.now() + 60_000), csrfToken: 'expected' }) } } as any);
    const request = { cookies: { resume_session: token }, method: 'GET', originalUrl: '/api/resumes', user: { id: 'forged' } };
    await expect(guard.canActivate(context(request))).rejects.toMatchObject({ status: 403 });
    expect(request.user.id).toBe('owner');
  });

  it('requires ADMIN and accepts only the configured origin', () => {
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
    expect(() => checkOrigin(undefined)).toThrow();
    expect(() => checkOrigin('http://localhost:3000')).not.toThrow();
    expect(() => verifyCsrf('short', 'long-expected')).toThrow();
    expect(() => new AdminGuard().canActivate(context({ user }))).toThrow();
    expect(new AdminGuard().canActivate(context({ user: { ...user, role: 'ADMIN' } }))).toBe(true);
  });
});
