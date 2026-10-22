import { createHash } from 'node:crypto';
import type { PlaySession } from './play-session.js';
import { getPlayFrozenSystemPrompt } from './play-turn-prompt.js';

export interface PlayCompactionData {
  version: 1;
  turnsCovered: number;
  characters: Array<{ name: string; identity: string; relationshipChange: string; currentSituation: string }>;
  chronicle: string[];
  unresolvedThreads: string[];
  currentScene: { timeAndPlace: string; presentCharacters: string[]; atmosphere: string; immediateCrisis: string };
  voiceAndStyle: { pov: string; rhythm: string; tonePoints: string[] };
  /** Exact host state is carried independently of model prose, including costs and injuries. */
  resourceState: Record<string, unknown>;
}
export interface PlayCompactionPreview {
  sourceSessionId: string;
  sourceRevision: number;
  sourceTurnId: string;
  sourceHash: string;
  data: PlayCompactionData;
  recentText: string;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => { if (typeof v !== 'string' || !v.trim()) throw new Error('Archive fields require nonempty text.'); return v; };
const list = (v: unknown): string[] => { if (!Array.isArray(v)) throw new Error('Archive list required.'); return v.map(text); };
export function parsePlayCompaction(response: string): PlayCompactionData {
  if (response.length > 200_000) throw new Error('Archive exceeds size limit.');
  const match = /<剧情存档\s*>([\s\S]*?)(?:<\/剧情存档\s*>|$)/u.exec(response.trim());
  const raw = (match?.[1] ?? response).trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
  const v: unknown = JSON.parse(raw);
  if (!record(v) || v.version !== 1 || !Number.isInteger(v.turnsCovered) || (v.turnsCovered as number) < 1 || !Array.isArray(v.characters) || !record(v.currentScene) || !record(v.voiceAndStyle) || !record(v.resourceState)) throw new Error('Invalid five-dimension archive.');
  return { version: 1, turnsCovered: v.turnsCovered as number,
    characters: v.characters.map(c => { if (!record(c)) throw new Error('Invalid archive character.'); return { name: text(c.name), identity: text(c.identity), relationshipChange: text(c.relationshipChange), currentSituation: text(c.currentSituation) }; }),
    chronicle: list(v.chronicle), unresolvedThreads: list(v.unresolvedThreads),
    currentScene: { timeAndPlace: text(v.currentScene.timeAndPlace), presentCharacters: list(v.currentScene.presentCharacters), atmosphere: text(v.currentScene.atmosphere), immediateCrisis: text(v.currentScene.immediateCrisis) },
    voiceAndStyle: { pov: text(v.voiceAndStyle.pov), rhythm: text(v.voiceAndStyle.rhythm), tonePoints: list(v.voiceAndStyle.tonePoints) }, resourceState: v.resourceState,
  };
}
export function playCompactionSource(session: PlaySession): string {
  return JSON.stringify({ ids: session.selectedTurnIds, state: session.playLocalState, events: session.events.filter(e => session.turnArtifacts.filter(t => session.selectedTurnIds.includes(t.id)).some(t => t.eventIds.includes(e.id))), messages: session.transcript });
}
export function buildPlayCompactionPrompt(session: PlaySession): string {
  return ['暂停推演，生成五维剧情存档，不续写。输出 <剧情存档>JSON</剧情存档>。',
    'JSON: {version:1, turnsCovered:number, characters:[{name,identity,relationshipChange,currentSituation}], chronicle:string[], unresolvedThreads:string[], currentScene:{timeAndPlace,presentCharacters:string[],atmosphere,immediateCrisis}, voiceAndStyle:{pov,rhythm,tonePoints:string[]}, resourceState:object}.',
    '人物的 name/identity/relationshipChange/currentSituation 与 currentScene 的 timeAndPlace/presentCharacters/immediateCrisis 必须逐字引用历史或初始设定；没有依据填 未记录。chronicle 与 unresolvedThreads 每项必须是历史中逐字存在的引文，不得补写事实。resourceState 必须逐项完整保留给定状态，包括不可逆伤势、已消耗资源与未兑现约定。所有角色与场景描述只依据历史。',
    `turnsCovered 必须为 ${session.selectedTurnIds.length}.`,
    `resourceState: ${JSON.stringify(session.playLocalState)}`,
    `选中分支历史: ${playCompactionSource(session)}`].join('\n');
}
export function auditPlayCompaction(session: PlaySession, data: PlayCompactionData): string[] {
  const errors: string[] = [];
  const history = session.transcript.map(t => t.content).join('\n');
  if (data.turnsCovered !== session.selectedTurnIds.length) errors.push('Covered turns differ from selected branch.');
  // Canonical JSON comparison makes object key order irrelevant while retaining exact values.
  const stable = (v: unknown): string => JSON.stringify(v, (_k, value) => record(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))) : value);
  if (stable(data.resourceState) !== stable(session.playLocalState)) errors.push('Resource/state ledger changed or omitted facts.');
  for (const quote of [...data.chronicle, ...data.unresolvedThreads]) if (!history.includes(quote)) errors.push(`Unverified historical quote: ${quote}`);
  const factualSource = [history, session.sceneStart, session.userPersona ?? '', getPlayFrozenSystemPrompt(session)].join('\n');
  const facts = [...data.characters.flatMap(c => [c.name, c.identity, c.relationshipChange, c.currentSituation]), data.currentScene.timeAndPlace, ...data.currentScene.presentCharacters, data.currentScene.immediateCrisis];
  for (const fact of facts) if (fact !== '未记录' && !factualSource.includes(fact)) errors.push(`Unverified character/scene fact: ${fact}`);
  return errors;
}
export function createPlayCompactionPreview(session: PlaySession, response: string): PlayCompactionPreview {
  if (session.schemaVersion !== 4 || !session.selectedTurnIds.length) throw new Error('Archive requires a committed immersive session.');
  const data = parsePlayCompaction(response);
  const errors = auditPlayCompaction(session, data);
  if (errors.length) throw new Error(errors.join('\n'));
  return { sourceSessionId: session.id, sourceRevision: session.revision, sourceTurnId: session.selectedTurnIds.at(-1)!, sourceHash: createHash('sha256').update(playCompactionSource(session)).digest('hex'), data,
    recentText: session.turnArtifacts.filter(t => session.selectedTurnIds.slice(-2).includes(t.id)).flatMap(t => t.messages.map(m => `【${m.speaker}】${m.content}`)).join('\n') };
}
export function createCompactedPlaySession(session: PlaySession, preview: PlayCompactionPreview, id: string): PlaySession {
  if (preview.sourceSessionId !== session.id || preview.sourceRevision !== session.revision || preview.sourceTurnId !== session.selectedTurnIds.at(-1) || preview.sourceHash !== createHash('sha256').update(playCompactionSource(session)).digest('hex')) throw new Error('Archive preview is stale; generate it again.');
  const errors = auditPlayCompaction(session, preview.data); if (errors.length) throw new Error(errors.join('\n'));
  // Keep the immutable graph: event IDs, hidden knowledge and schedules refer to it.
  // Only model-visible history is compacted; the new session is independently writable.
  const next = structuredClone(session);
  next.id = id;
  next.title = `${session.title} · 新阶段`;
  next.createdAt = new Date().toISOString();
  next.metadataExtensions = { ...session.metadataExtensions, playCompactionStartRevision: session.revision, frozenSystemPrompt: getPlayFrozenSystemPrompt(session), playCompaction: preview,
    playContinuation: `<前情提要>\n<剧情存档>${JSON.stringify(preview.data)}</剧情存档>\n<最近原文>${preview.recentText}</最近原文>\n</前情提要>` };
  delete next.metadataExtensions.playCompactionPreview;
  return next;
}
