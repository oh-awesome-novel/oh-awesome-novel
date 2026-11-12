import type { PlayLaunchPackage, PlayLaunchSourceInput } from './play-launch.js';

export interface PlayOriginWork { id: string; title: string }
export interface PlayCrossoverContract {
  works: PlayOriginWork[];
  fusion: 'merged' | 'visitor' | 'layered';
  knowledge: 'isolated' | 'shared';
  rulePrecedence: Array<{ topic: string; winner: string; note: string }>;
}
export interface PlayCrossoverContext {
  schemaVersion: 1;
  contract: PlayCrossoverContract;
  sources: Array<{ sourceId: string; path: string; contentHash: string; excerpt: string; originWork?: PlayOriginWork }>;
  participants: Array<{ participantRef: string; displayName: string; originWorkId?: string; sourceIds: string[] }>;
}
export const PLAY_CROSSOVER_METADATA_KEY = 'playCrossover';

export interface PlaySourceKnowledgeGrantRecord {
  id: string;
  kind: 'sourceGrant';
  participantRef: string;
  sourceId: string;
  learnedAtTurnId: string;
  learnedByEventId: string;
  canonical: false;
}
export interface PlayLearnSourceKnowledgeChange {
  type: 'learnSource'; participantRef: string; sourceId: string; eventRef: number;
}
export function normalizePlaySourceGrant(value: unknown): PlaySourceKnowledgeGrantRecord {
  const v = object(value, ['id', 'kind', 'participantRef', 'sourceId', 'learnedAtTurnId', 'learnedByEventId', 'canonical']);
  if (v.kind !== 'sourceGrant' || v.canonical !== false) throw new Error('跨作品认知记录无效。');
  return { id: safeId(v.id), kind: 'sourceGrant', participantRef: safeId(v.participantRef), sourceId: safeId(v.sourceId),
    learnedAtTurnId: safeId(v.learnedAtTurnId), learnedByEventId: safeId(v.learnedByEventId), canonical: false };
}
export function normalizePlayLearnSourceChange(value: unknown): PlayLearnSourceKnowledgeChange {
  const v = object(value, ['type', 'participantRef', 'sourceId', 'eventRef']);
  if (v.type !== 'learnSource' || typeof v.eventRef !== 'number' || !Number.isSafeInteger(v.eventRef) || v.eventRef < 1 || v.eventRef > 12) throw new Error('跨作品认知需要本回合事件依据。');
  return { type: 'learnSource', participantRef: safeId(v.participantRef), sourceId: safeId(v.sourceId), eventRef: v.eventRef };
}
export function assertPlaySourceGrantTarget(context: PlayCrossoverContext | undefined, participantRef: string, sourceId: string): void {
  const participant = context?.participants.find(p => p.participantRef === participantRef);
  if (!participant || !context?.sources.some(s => s.sourceId === sourceId)) throw new Error('跨作品认知引用未启用的契约、未知人物或来源。');
  if (participant.sourceIds.includes(sourceId)) throw new Error('人物初始已知道此来源。');
}

export function normalizePlayOriginWork(value: unknown): PlayOriginWork {
  const v = object(value, ['id', 'title']);
  return { id: safeId(v.id), title: text(v.title, 120) };
}

export function collectPlayOriginWorks(sources: readonly { originWork?: PlayOriginWork }[]): PlayOriginWork[] {
  const works = new Map<string, PlayOriginWork>();
  for (const source of sources) {
    if (!source.originWork) continue;
    const work = normalizePlayOriginWork(source.originWork);
    if (works.has(work.id) && works.get(work.id)!.title !== work.title) throw new Error('同一作品 id 不能使用不同标题。');
    works.set(work.id, work);
  }
  return [...works.values()];
}

export function normalizePlayCrossoverContract(value: unknown): PlayCrossoverContract {
  const v = object(value, ['works', 'fusion', 'knowledge', 'rulePrecedence']);
  if (!Array.isArray(v.works) || v.works.length < 2 || v.works.length > 24) throw new Error('融合契约需要 2–24 部作品。');
  const works = v.works.map(normalizePlayOriginWork);
  if (new Set(works.map(w => w.id)).size !== works.length) throw new Error('融合契约作品重复。');
  if (v.fusion !== 'merged' && v.fusion !== 'visitor' && v.fusion !== 'layered') throw new Error('融合方式无效。');
  if (v.knowledge !== 'isolated' && v.knowledge !== 'shared') throw new Error('默认认知无效。');
  if (!Array.isArray(v.rulePrecedence) || v.rulePrecedence.length > 24) throw new Error('最多填写 24 条规则裁定。');
  const rulePrecedence = v.rulePrecedence.map(value => {
    const rule = object(value, ['topic', 'winner', 'note']);
    const winner = safeId(rule.winner);
    if (!works.some(work => work.id === winner)) throw new Error('规则裁定引用未知作品。');
    return { topic: text(rule.topic, 120), winner, note: text(rule.note, 1000) };
  });
  return { works, fusion: v.fusion, knowledge: v.knowledge, rulePrecedence };
}

export function validatePlayLaunchCrossover(sources: readonly Pick<PlayLaunchSourceInput, 'originWork'>[], value: unknown): PlayCrossoverContract | undefined {
  const works = collectPlayOriginWorks(sources);
  if (value === undefined) {
    if (works.length >= 2) throw new Error('选择多部作品后，请确认融合契约。');
    return undefined;
  }
  const contract = normalizePlayCrossoverContract(value);
  if (works.length !== contract.works.length || works.some(work => !contract.works.some(w => w.id === work.id && w.title === work.title))) {
    throw new Error('融合契约作品清单与来源标注不一致。');
  }
  return contract;
}

export function createPlayCrossoverContext(pkg: PlayLaunchPackage): PlayCrossoverContext | undefined {
  const contract = validatePlayLaunchCrossover(pkg.sourceBase.activatedSources, pkg.crossover);
  if (!contract) return undefined;
  const sources = pkg.sourceBase.activatedSources.map(source => ({
    sourceId: source.sourceId, path: source.path, contentHash: source.contentHash!, excerpt: source.excerpt!,
    ...(source.originWork ? { originWork: source.originWork } : {}),
  }));
  const participants = pkg.participantRoles.map(participant => {
    const own = collectPlayOriginWorks(pkg.sourceBase.activatedSources.filter(source =>
      source.role === 'character' && participant.sourceRefs.includes(source.sourceId) &&
      (!participant.canonicalCharacterRef || source.objectId === participant.canonicalCharacterRef)));
    if (own.length > 1) throw new Error(`人物 ${participant.displayName} 关联了多部作品的角色来源，请明确选择。`);
    const originWorkId = own[0]?.id;
    return {
      participantRef: participant.participantRef, displayName: participant.displayName,
      ...(originWorkId ? { originWorkId } : {}),
      sourceIds: sources.filter(source => contract.knowledge === 'shared' || originWorkId && source.originWork?.id === originWorkId).map(source => source.sourceId),
    };
  });
  return normalizePlayCrossoverContext({ schemaVersion: 1, contract, sources, participants });
}

export function normalizePlayCrossoverContext(value: unknown): PlayCrossoverContext {
  const v = object(value, ['schemaVersion', 'contract', 'sources', 'participants']);
  if (v.schemaVersion !== 1 || !Array.isArray(v.sources) || v.sources.length > 24 || !Array.isArray(v.participants) || v.participants.length > 16) throw new Error('融合上下文无效。');
  const contract = normalizePlayCrossoverContract(v.contract);
  const sources = v.sources.map(value => {
    const source = object(value, ['sourceId', 'path', 'contentHash', 'excerpt', 'originWork']);
    if (typeof source.contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(source.contentHash)) throw new Error('融合来源 hash 无效。');
    return {
      sourceId: safeId(source.sourceId), path: text(source.path, 1000), contentHash: source.contentHash,
      excerpt: text(source.excerpt, 2000), ...(source.originWork === undefined ? {} : { originWork: normalizePlayOriginWork(source.originWork) }),
    };
  });
  if (new Set(sources.map(s => s.sourceId)).size !== sources.length) throw new Error('融合来源重复。');
  validatePlayLaunchCrossover(sources, contract);
  const participants = v.participants.map(value => {
    const participant = object(value, ['participantRef', 'displayName', 'originWorkId', 'sourceIds']);
    const originWorkId = participant.originWorkId === undefined ? undefined : safeId(participant.originWorkId);
    if (originWorkId && !contract.works.some(work => work.id === originWorkId)) throw new Error('人物所属作品无效。');
    const expected = sources.filter(source => contract.knowledge === 'shared' || originWorkId && source.originWork?.id === originWorkId).map(source => source.sourceId);
    if (!Array.isArray(participant.sourceIds) || participant.sourceIds.length !== expected.length || participant.sourceIds.some((id, i) => id !== expected[i])) throw new Error('人物初始来源越过作品边界。');
    return { participantRef: safeId(participant.participantRef), displayName: text(participant.displayName, 200), ...(originWorkId ? { originWorkId } : {}), sourceIds: expected };
  });
  if (new Set(participants.map(p => p.participantRef)).size !== participants.length) throw new Error('融合参与者重复。');
  return { schemaVersion: 1, contract, sources, participants };
}

export function readPlayCrossoverContext(metadata?: Record<string, unknown>): PlayCrossoverContext | undefined {
  const value = metadata?.[PLAY_CROSSOVER_METADATA_KEY];
  return value === undefined ? undefined : normalizePlayCrossoverContext(value);
}

export function formatPlayCrossoverProtocol(context: PlayCrossoverContext): string {
  return [
    '# 综漫融合契约（只属于本次推演）',
    JSON.stringify({ contract: context.contract, sources: context.sources.map(({ excerpt: _excerpt, ...source }) => source), participants: context.participants }),
    '作品归属不代表跨作品人物同一性。按 rulePrecedence 裁定规则，未裁定部分保持不确定；不要自行合并同名人物。',
    'isolated 时每个角色初始只知道其 sourceIds；其他作品资料属于裁判知识，不可让角色默认知晓。shared 时作者允许已选来源互知。',
    '角色在场获知另一来源时，显式返回 knowledgeChanges: [{type:"learnSource",participantRef,sourceId,eventRef}]。eventRef 是本回合 informationSpread 事件的一基位置；没有事件依据不授予。只可授予冻结的来源，不得发明 id。',
    '之前已记录的 sourceGrant 随分支生效。它不是对玩家的自动揭示，隐藏原因和私有角色认知不能进入参与者叙述。',
  ].join('\n');
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('融合契约含无效或未知字段。');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000\u000b\u000c]/u.test(value)) throw new Error('融合契约文本无效或过长。');
  return value.trim();
}
function safeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/u.test(value) || value.includes('..')) throw new Error('融合契约标识无效。');
  return value;
}
