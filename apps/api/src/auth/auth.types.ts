import type { Request } from 'express';

export interface AuthUser { id: string; email: string; role: 'USER' | 'ADMIN'; emailVerifiedAt: Date | null }
export interface AuthRequest extends Request { user: AuthUser; session: { id: string; csrfToken: string } }
