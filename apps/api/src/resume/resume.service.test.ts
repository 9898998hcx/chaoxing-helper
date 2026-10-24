import { describe, expect, it, vi } from 'vitest';
import { initialSections } from '@resume/shared';
import { ResumeService } from './resume.service.js';

describe('Resume ownership and optimistic concurrency', () => {
  it('scopes reads to authenticated user and hides other users records', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ResumeService({ resume: { findFirst } } as any);
    await expect(service.get('attacker', 'victim-resume')).rejects.toMatchObject({ status: 404 });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'victim-resume', userId: 'attacker' });
  });

  it('scopes delete to authenticated user without deleting someone else', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const service = new ResumeService({ resume: { deleteMany } } as any);
    await expect(service.remove('attacker', 'victim-resume')).rejects.toMatchObject({ status: 404 });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'victim-resume', userId: 'attacker' } });
  });

  it('does not modify sections when the submitted revision is stale', async () => {
    const tx = {
      resume: { findFirst: vi.fn().mockResolvedValue({ id: 'resume', userId: 'owner', revision: 4, templateId: null, sections: [] }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      resumeSection: { deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const service = new ResumeService({ $transaction: (fn: any) => fn(tx) } as any);
    await expect(service.update('owner', 'resume', { title: 'new', sections: initialSections() }, 3)).rejects.toMatchObject({ status: 409 });
    expect(tx.resume.updateMany.mock.calls[0][0].where).toEqual({ id: 'resume', userId: 'owner', revision: 3 });
    expect(tx.resumeSection.deleteMany).not.toHaveBeenCalled();
  });

  it('never reveals a foreign version during restore', async () => {
    const date = new Date();
    const findFirst = vi.fn().mockResolvedValue({ id: 'resume', userId: 'owner', title: 'own', templateId: null, revision: 1, createdAt: date, updatedAt: date, sections: [] });
    const findVersion = vi.fn().mockResolvedValue(null);
    const service = new ResumeService({ resume: { findFirst }, resumeVersion: { findFirst: findVersion } } as any);
    await expect(service.restore('owner', 'resume', 'foreign-version', 1)).rejects.toMatchObject({ status: 404 });
    expect(findVersion).toHaveBeenCalledWith({ where: { id: 'foreign-version', resumeId: 'resume', resume: { userId: 'owner' } } });
  });
});
