import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service.js';
import { apiError } from '../common/errors.js';
import { encryptSecret } from '../common/secret-crypto.js';

const input = { resumeId: 'resume-owner', scenario: 'generate-section', sectionType: 'work', jd: 'PRIVATE JD TEXT', experience: 'PRIVATE EXPERIENCE TEXT' };
const result = { sectionType: 'work', items: [{ company: '用户提供公司', role: '工程师', description: '改进表达' }], suggestions: ['补充真实成果'] };
const reply = (content = JSON.stringify(result)) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 40 } }), { status: 200 });

function fixture() {
  const log = { count: vi.fn().mockResolvedValue(0), aggregate: vi.fn().mockResolvedValue({ _sum: { estimatedTokens: 0 } }), create: vi.fn().mockResolvedValue({ id: 'generation' }), update: vi.fn().mockResolvedValue({}) };
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue({ customDeepseekKey: null }), update: vi.fn().mockResolvedValue({ id: 'owner' }) },
    resume: { findFirst: vi.fn().mockResolvedValue({ id: 'resume-owner', userId: 'owner', templateId: null, sections: [{ type: 'work', content: [{ company: 'PRIVATE RESUME COMPANY' }] }] }), update: vi.fn() },
    template: { findFirst: vi.fn().mockResolvedValue(null) },
    aiGenerationLog: log,
    $transaction: vi.fn((fn: any, _options?: any) => fn({ aiGenerationLog: log })),
  };
  const redis = { consume: vi.fn().mockResolvedValue({ remaining: 4 }) };
  const service = new AiService(prisma as any, redis as any);
  service.fetcher = vi.fn().mockImplementation(() => Promise.resolve(reply()));
  return { service, prisma, log, redis };
}

beforeEach(() => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'SERVER-SECRET-KEY');
  vi.stubEnv('DEEPSEEK_MAX_RETRIES', '0');
  vi.stubEnv('DEEPSEEK_TIMEOUT_MS', '1000');
  vi.stubEnv('AI_MONTHLY_TOKEN_LIMIT', '1000000');
  vi.stubEnv('AI_DAILY_LIMIT', '20');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('AI safety, failure handling, and budgets', () => {
  it('rejects missing keys and writes a redacted log without a persisted quota reservation', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    const { service, log, redis } = fixture();
    await expect(service.generate('owner', input)).rejects.toMatchObject({ status: 503 });
    expect(service.fetcher).not.toHaveBeenCalled();
    expect(redis.consume).toHaveBeenCalledWith('ai:minute:owner', 5, 60);
    expect(log.count).not.toHaveBeenCalled();
    expect(log.create.mock.calls[0][0].data).toMatchObject({ userId: 'owner', scenario: 'generate-section', status: 'FAILED', estimatedTokens: 0, errorCode: 'AI_NOT_CONFIGURED' });
    expect(JSON.stringify(log.create.mock.calls)).not.toContain('PRIVATE');
  });

  it('throttles missing-key failures before they can flood the database with logs', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    const { service, log, redis } = fixture();
    redis.consume.mockRejectedValue(apiError(429, 'RATE_LIMITED', '请求过于频繁'));
    await expect(service.generate('owner', input)).rejects.toMatchObject({ status: 429 });
    expect(log.create).not.toHaveBeenCalled();
    expect(service.fetcher).not.toHaveBeenCalled();
  });

  it('checks resume ownership before provider or quota operations', async () => {
    const { service, prisma, log } = fixture();
    prisma.resume.findFirst.mockResolvedValue(null as any);
    await expect(service.generate('attacker', input)).rejects.toMatchObject({ status: 404 });
    expect(prisma.resume.findFirst.mock.calls[0][0].where).toEqual({ id: input.resumeId, userId: 'attacker' });
    expect(log.create).not.toHaveBeenCalled();
    expect(service.fetcher).not.toHaveBeenCalled();
  });

  it('returns a schema-checked suggestion without modifying the resume or logging text', async () => {
    const { service, prisma, log } = fixture();
    const response = await service.generate('owner', input);
    expect(response).toMatchObject({ generationId: 'generation', result, quota: { remaining: 19, dailyLimit: 20 } });
    expect(prisma.resume.update).not.toHaveBeenCalled();
    expect(log.update.mock.calls[0][0].data).toMatchObject({ status: 'SUCCEEDED', inputTokens: 100, outputTokens: 40 });
    const logged = JSON.stringify([log.create.mock.calls, log.update.mock.calls]);
    expect(logged).not.toContain('PRIVATE');
    expect(logged).not.toContain('SERVER-SECRET-KEY');
    expect(logged).not.toContain('改进表达');
    expect(prisma.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: 'Serializable' });
    expect(vi.mocked(service.fetcher).mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer SERVER-SECRET-KEY' } });
  });

  it('encrypts a custom key at rest and only returns its masked form', async () => {
    vi.stubEnv('USER_SECRET_ENCRYPTION_KEY', 'ab'.repeat(32));
    const { service, prisma } = fixture();
    const plaintext = 'sk-custom-secret-1234';
    await expect(service.setSettings('owner', plaintext)).resolves.toEqual({ configured: true, maskedKey: 'sk-****1234' });
    const stored = prisma.user.update.mock.calls[0][0].data.customDeepseekKey;
    expect(stored).toEqual(expect.any(String));
    expect(stored).not.toContain(plaintext);
    prisma.user.findUnique.mockResolvedValue({ customDeepseekKey: stored });
    await expect(service.getSettings('owner')).resolves.toEqual({ configured: true, maskedKey: 'sk-****1234' });
  });

  it('rejects the fourth system-key request at the daily limit', async () => {
    vi.stubEnv('AI_DAILY_LIMIT', '3');
    const { service, log } = fixture();
    log.count.mockResolvedValue(3);
    const error = await service.generate('owner', input).catch(error => error);
    expect(error).toMatchObject({ status: 429 });
    expect(error.getResponse()).toEqual({ error: { code: 'AI_DAILY_LIMIT', message: '今日 AI 次数已用完，请明日再试' } });
    expect(service.fetcher).not.toHaveBeenCalled();
    expect(log.create).not.toHaveBeenCalled();
  });

  it('uses a custom key without consuming the system daily quota', async () => {
    vi.stubEnv('USER_SECRET_ENCRYPTION_KEY', 'ab'.repeat(32));
    vi.stubEnv('AI_DAILY_LIMIT', '3');
    const { service, prisma, log } = fixture();
    prisma.user.findUnique.mockResolvedValue({ customDeepseekKey: encryptSecret('sk-custom-secret-1234') });
    log.count.mockResolvedValue(3);
    const response = await service.generate('owner', input);
    expect(response.quota).toMatchObject({ remaining: null, dailyLimit: null });
    expect(log.count).not.toHaveBeenCalled();
    expect(log.create.mock.calls[0][0].data).toMatchObject({ quotaExempt: true });
    expect(vi.mocked(service.fetcher).mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer sk-custom-secret-1234' } });
  });

  it('does not expose a custom key in upstream failures or generation logs', async () => {
    vi.stubEnv('USER_SECRET_ENCRYPTION_KEY', 'ab'.repeat(32));
    const { service, prisma, log } = fixture();
    const plaintext = 'sk-custom-secret-1234';
    prisma.user.findUnique.mockResolvedValue({ customDeepseekKey: encryptSecret(plaintext) });
    service.fetcher = vi.fn().mockResolvedValue(new Response(`${plaintext} private upstream details`, { status: 401 }));
    const error = await service.generate('owner', input).catch(error => error);
    expect(error).toMatchObject({ status: 401 });
    expect(error.getResponse()).toEqual({ error: { code: 'AI_CUSTOM_KEY_INVALID', message: '您的 API Key 无效，请检查后重试' } });
    expect(JSON.stringify(error.getResponse())).not.toContain(plaintext);
    expect(JSON.stringify(log.create.mock.calls)).not.toContain(plaintext);
    expect(JSON.stringify(log.update.mock.calls)).not.toContain(plaintext);
  });

  it('clearing a custom key restores the system key and daily quota', async () => {
    vi.stubEnv('USER_SECRET_ENCRYPTION_KEY', 'ab'.repeat(32));
    vi.stubEnv('AI_DAILY_LIMIT', '3');
    const { service, prisma } = fixture();
    await expect(service.setSettings('owner', 'sk-custom-secret-1234')).resolves.toMatchObject({ configured: true });
    await expect(service.setSettings('owner', null)).resolves.toEqual({ configured: false, maskedKey: null });
    expect(prisma.user.update.mock.calls.at(-1)?.[0].data.customDeepseekKey).toBeNull();
    prisma.user.findUnique.mockResolvedValue({ customDeepseekKey: null });
    const response = await service.generate('owner', input);
    expect(response.quota).toMatchObject({ remaining: 2, dailyLimit: 3 });
    expect(vi.mocked(service.fetcher).mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer SERVER-SECRET-KEY' } });
  });

  it('only sends permitted template structure labels and never source text or images', async () => {
    const { service, prisma } = fixture();
    prisma.template.findFirst.mockResolvedValue({ id: 'template', sectionOrder: ['basic', 'work', 'unknown'], layout: 'single-column', style: 'professional', title: 'COPYRIGHT TITLE', description: 'COPYRIGHT FULL TEXT', thumbnailUrl: 'https://copyright.invalid/image', sourceUrl: 'https://source.invalid' } as any);
    await service.generate('owner', { ...input, templateId: 'template' });
    expect(prisma.template.findFirst.mock.calls[0][0]).toEqual({ where: { id: 'template', status: 'APPROVED' }, select: { id: true, sectionOrder: true, layout: true, style: true } });
    const request = vi.mocked(service.fetcher).mock.calls[0][1];
    const serialized = request?.body as string;
    expect(serialized).toContain('single-column');
    expect(serialized).not.toContain('COPYRIGHT');
    expect(serialized).not.toContain('source.invalid');
    expect(JSON.parse(serialized).response_format).toEqual({ type: 'json_object' });
  });

  it('retries temporary upstream rate limits within the reserved maximum attempts', async () => {
    vi.stubEnv('DEEPSEEK_MAX_RETRIES', '1');
    const { service, log } = fixture();
    service.fetcher = vi.fn().mockResolvedValueOnce(new Response('secret upstream response', { status: 429 })).mockResolvedValueOnce(reply());
    await expect(service.generate('owner', input)).resolves.toMatchObject({ generationId: 'generation' });
    expect(service.fetcher).toHaveBeenCalledTimes(2);
    expect(log.create).toHaveBeenCalledTimes(1);
  });

  it('bounds timeout retries and exposes a safe timeout error', async () => {
    vi.stubEnv('DEEPSEEK_MAX_RETRIES', '1');
    vi.stubEnv('DEEPSEEK_TIMEOUT_MS', '100');
    const { service, log } = fixture();
    service.fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
    await expect(service.generate('owner', input)).rejects.toMatchObject({ status: 504 });
    expect(service.fetcher).toHaveBeenCalledTimes(2);
    expect(log.update.mock.calls[0][0].data).toMatchObject({ status: 'FAILED', errorCode: 'AI_TIMEOUT' });
  });

  it('rejects malformed output rather than accepting a different module or arbitrary fields', async () => {
    const { service, log } = fixture();
    service.fetcher = vi.fn().mockResolvedValue(reply(JSON.stringify({ ...result, sectionType: 'basic' })));
    await expect(service.generate('owner', input)).rejects.toMatchObject({ status: 502 });
    expect(log.update.mock.calls[0][0].data.errorCode).toBe('AI_INVALID_OUTPUT');
    expect(service.fetcher).toHaveBeenCalledTimes(1);
  });

  it('enforces persisted daily and global monthly reservations before calling DeepSeek', async () => {
    const daily = fixture();
    daily.log.count.mockResolvedValue(20);
    await expect(daily.service.generate('owner', input)).rejects.toMatchObject({ status: 429 });
    expect(daily.service.fetcher).not.toHaveBeenCalled();
    expect(daily.log.create).not.toHaveBeenCalled();
    const monthly = fixture();
    monthly.log.aggregate.mockResolvedValue({ _sum: { estimatedTokens: 999999 } });
    await expect(monthly.service.generate('owner', input)).rejects.toMatchObject({ status: 429 });
    expect(monthly.service.fetcher).not.toHaveBeenCalled();
    expect(monthly.log.create).not.toHaveBeenCalled();
  });

  it('does not forward an upstream secret-bearing error body', async () => {
    const { service, log } = fixture();
    service.fetcher = vi.fn().mockResolvedValue(new Response('SERVER-SECRET-KEY private account details', { status: 401 }));
    const error = await service.generate('owner', input).catch(error => error);
    expect(error.status).toBe(503);
    expect(JSON.stringify(error.getResponse())).not.toContain('SERVER-SECRET');
    expect(JSON.stringify(log.update.mock.calls)).not.toContain('private account');
  });
});
