import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage } from './api';

describe('AI API error presentation', () => {
  it('translates an invalid BYOK response to the user-facing message', () => {
    expect(errorMessage(new ApiError(401, 'AI_CUSTOM_KEY_INVALID', 'upstream detail'))).toBe('您的 API Key 无效，请检查后重试');
  });
});
