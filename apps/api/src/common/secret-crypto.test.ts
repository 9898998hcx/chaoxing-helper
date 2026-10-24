import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret, maskSecret } from './secret-crypto.js';

afterEach(() => vi.unstubAllEnvs());

describe('secret crypto', () => {
  it('encrypts and decrypts a BYOK value without storing plaintext', () => {
    vi.stubEnv('USER_SECRET_ENCRYPTION_KEY', '11'.repeat(32));
    const plaintext = 'sk-test-secret-1234';
    const ciphertext = encryptSecret(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptSecret(ciphertext)).toBe(plaintext);
    expect(maskSecret(plaintext)).toBe('sk-****1234');
  });

  it('rejects an unavailable encryption key without exposing secret material', () => {
    vi.stubEnv('USER_SECRET_ENCRYPTION_KEY', '');
    try {
      encryptSecret('sk-test-secret-1234');
      throw new Error('expected encryption to fail');
    } catch (error: any) {
      expect(error.getResponse()).toEqual({ error: { code: 'BYOK_ENCRYPTION_NOT_CONFIGURED', message: '用户 API Key 加密服务尚未配置' } });
    }
  });
});
