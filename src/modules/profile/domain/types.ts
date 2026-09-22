/** Personal facts NEVER live in the world state; transfer requires explicit selection. */
export type ProfileFact = {
  id: string;
  category: 'identity' | 'interest' | 'personality' | 'relationship' | 'experience' | 'wish';
  value: string;
  status: 'suggested' | 'confirmed' | 'rejected';
  sourceMessageIds: string[];
  updatedAt: string;
};
export type PersonalProfile = { id: string; ownerId: string; version: number; facts: ProfileFact[] };
export type LifeProposal = {
  id: string; ownerId: string; profileVersion: number; title: string;
  premise: string; reason: string; basisFactIds: string[];
};
export type ApprovedWorldSeed = {
  id: string; ownerId: string; proposalId: string; profileVersion: number;
  selectedFactIds: string[]; selectedAssetIds: string[]; approvedAt: string;
};
