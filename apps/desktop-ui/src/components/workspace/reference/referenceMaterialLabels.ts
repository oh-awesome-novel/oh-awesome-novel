import type { ReferenceMaterialAdoptionEntry } from '../../../composables/useWorkspaceApi';

type MaterialKind = ReferenceMaterialAdoptionEntry['materialKind'];

export const MATERIAL_KINDS: readonly MaterialKind[] = [
  'world', 'characters', 'relationships', 'outline', 'timeline',
];

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  world: '世界设定',
  characters: '角色',
  relationships: '人物关系',
  outline: '大纲',
  timeline: '时间线',
};

export const CONFIDENCE_LABELS: Record<ReferenceMaterialAdoptionEntry['confidence'], string> = {
  high: '把握高',
  medium: '把握中',
  low: '把握低',
};

export const DECISION_LABELS: Record<'create' | 'update' | 'skip' | 'delete', string> = {
  create: '新增',
  update: '修改',
  skip: '跳过',
  delete: '删除',
};
