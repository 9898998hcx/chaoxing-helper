import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { apiError, ApiExceptionFilter } from './errors.js';

describe('Public error envelope', () => {
  it('preserves explicit module error codes when normalizing Nest exceptions', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as any;
    new ApiExceptionFilter().catch(new BadRequestException({ code: 'SOURCE_NOT_AUTHORIZED', message: '来源未授权' }), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: { code: 'SOURCE_NOT_AUTHORIZED', message: '来源未授权' } });
  });

  it('keeps nested API errors and hides unknown exception details', () => {
    const json = vi.fn();
    const host = { switchToHttp: () => ({ getResponse: () => ({ status: () => ({ json }) }) }) } as any;
    new ApiExceptionFilter().catch(apiError(409, 'REVISION_CONFLICT', '版本冲突'), host);
    expect(json).toHaveBeenLastCalledWith({ error: { code: 'REVISION_CONFLICT', message: '版本冲突' } });
    new ApiExceptionFilter().catch(new Error('database-password-secret'), host);
    expect(JSON.stringify(json.mock.lastCall)).not.toContain('database-password-secret');
  });
});
