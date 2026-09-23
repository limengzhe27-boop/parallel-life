import { DomainError } from '../domain/errors.ts';
import type { MemoryRecord } from '../domain/types.ts';

export interface ProfileCandidateFact {
  id: string;
  ownerId: string;
  text: string;
  category: 'experience' | 'wish' | 'interest' | 'preference';
  sourceBranchId: string;
  status: 'suggested' | 'confirmed' | 'rejected';
  userConsentedAt?: string;
  confirmedAt?: string;
}

/**
 * 虚构分支愿望反向写回管理：
 * 绝不能自动把分支的角色扮演对话写进现实档案！
 * 必须经过：Agent提议 -> 用户显式同意 -> 现实候选 -> 现实档案手动确认 四道防线。
 */
export class ReverseWritebackManager {
  private candidates: ProfileCandidateFact[] = [];

  /**
   * 第一步：Agent 在分支识别出真切愿望，经用户在分支对话中点击“同意记录”后，
   * 才能生成候选资料（status: 'suggested'）。
   */
  createCandidateFromBranch(params: {
    id: string;
    ownerId: string;
    branchMemory: MemoryRecord;
    userConsented: boolean;
    category: ProfileCandidateFact['category'];
  }): ProfileCandidateFact {
    if (!params.userConsented) {
      throw new DomainError(
        'FORBIDDEN',
        'User consent is strictly required to propose a branch memory writeback',
      );
    }

    if (params.branchMemory.scopeType !== 'branch' || !params.branchMemory.branchId) {
      throw new DomainError('INVALID_COMMAND', 'Memory is not from a valid branch scope');
    }

    const candidate: ProfileCandidateFact = {
      id: params.id,
      ownerId: params.ownerId,
      text: params.branchMemory.text,
      category: params.category,
      sourceBranchId: params.branchMemory.branchId,
      status: 'suggested',
      userConsentedAt: new Date().toISOString(),
    };

    this.candidates.push(candidate);
    return candidate;
  }

  /**
   * 第二步：用户在「现实档案」页面正式点击确认，候选事实才能升格为已确认档案
   */
  confirmCandidate(candidateId: string, ownerId: string): ProfileCandidateFact {
    const item = this.candidates.find((c) => c.id === candidateId);
    if (!item) {
      throw new DomainError('NOT_FOUND', `Candidate fact ${candidateId} not found`);
    }
    if (item.ownerId !== ownerId) {
      throw new DomainError('FORBIDDEN', 'Cannot confirm candidate of another owner');
    }
    if (item.status !== 'suggested') {
      throw new DomainError('INVALID_STATE', `Candidate is not in suggested state: ${item.status}`);
    }

    item.status = 'confirmed';
    item.confirmedAt = new Date().toISOString();
    return item;
  }

  getCandidates(ownerId: string): ProfileCandidateFact[] {
    return this.candidates.filter((c) => c.ownerId === ownerId);
  }
}
