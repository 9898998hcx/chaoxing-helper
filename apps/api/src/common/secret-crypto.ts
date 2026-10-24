import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { apiError } from './errors.js';

const VERSION = 'v1';

function encryptionKey() {
  const value = process.env.USER_SECRET_ENCRYPTION_KEY?.trim() ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw apiError(503, 'BYOK_ENCRYPTION_NOT_CONFIGURED', '用户 API Key 加密服务尚未配置');
  return Buffer.from(value, 'hex');
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${VERSION}.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(value: string) {
  try {
    const [version, ivText, tagText, ciphertextText] = value.split('.');
    if (version !== VERSION || !ivText || !tagText || !ciphertextText) throw new Error('invalid secret envelope');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (typeof (error as any)?.getStatus === 'function') throw error;
    throw apiError(503, 'BYOK_SECRET_UNAVAILABLE', '用户 API Key 无法解密，请重新保存');
  }
}

export function maskSecret(value: string | null | undefined) {
  if (!value) return null;
  return value.startsWith('sk-') && value.length >= 7 ? `sk-****${value.slice(-4)}` : `****${value.slice(-4)}`;
}
