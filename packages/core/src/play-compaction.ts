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
/** Current claims are field-bound to the selected state, never validated by old prose. */
function currentCompactionEvidence(session: PlaySession) {
  const state = session.playLocalState;
  const scene = record(state.currentScene) ? state.currentScene : {};
  const nonempty = (value: unknown): string[] => typeof value === 'string' && value.trim() ? [value] : [];
  const names = (value: unknown): string[] => Array.isArray(value) && value.every(v => typeof v === 'string') ? value : [];
  const place = [...nonempty(scene.timeAndPlace), ...nonempty(state.timeAndPlace), ...nonempty(state.currentScene), ...nonempty(scene.location), ...nonempty(state.location)];
  const characters: Record<string, { identity: string[]; relationshipChange: string[]; currentSituation: string[] }> = Object.create(null);
  const characterStates = record(state.characters) ? state.characters : {};
  for (const [name, value] of Object.entries(characterStates)) {
    if (!record(value)) continue;
    characters[name] = {
      identity: nonempty(value.identity),
      relationshipChange: nonempty(value.relationshipChange),
      // A serialized per-character ledger preserves quantitative conditions without asking the model to paraphrase them.
      currentSituation: [...nonempty(value.currentSituation), JSON.stringify(value)],
    };
  }
  return { characters,
    currentScene: {
      timeAndPlace: place,
      presentCharacters: names(scene.presentCharacters ?? state.presentCharacters),
      atmosphere: [...nonempty(scene.atmosphere), ...nonempty(state.atmosphere)],
      immediateCrisis: [...nonempty(scene.immediateCrisis), ...nonempty(state.immediateCrisis)],
    },
    unresolvedThreads: names(state.unresolvedThreads),
  };
}
export function buildPlayCompactionPrompt(session: PlaySession): string {
  return ['暂停推演，生成五维剧情存档，不续写。输出 <剧情存档>JSON</剧情存档>。',
    'JSON: {version:1, turnsCovered:number, characters:[{name,identity,relationshipChange,currentSituation}], chronicle:string[], unresolvedThreads:string[], currentScene:{timeAndPlace,presentCharacters:string[],atmosphere,immediateCrisis}, voiceAndStyle:{pov,rhythm,tonePoints:string[]}, resourceState:object}.',
    'name 可引用历史或初始设定。人物 identity/relationshipChange/currentSituation 和 currentScene 各字段只能从下方对应角色、对应字段的当前证据白名单逐字选择；没有值填 未记录，presentCharacters 无记录填空数组；白名单已有证据不得用 未记录 省略，所有当前角色与未结线索必须保留。不得把历史的健康、资源存量、关系或旧危机当成当前事实，即使它们是逐字引文。currentSituation 可以使用白名单中的完整角色状态 JSON 字符串。',
    'chronicle 每项必须逐字引用历史，允许记载已经改变的过去事实。unresolvedThreads 只能选择当前状态未结线索白名单中且历史存在逐字引文的条目；缺少字面历史依据必须报错修正，不得补写或静默省略。不得把已经解决的旧承诺列为未结线索。resourceState 必须逐项完整保留当前状态，包括不可逆伤势、已消耗资源与未兑现约定。',
    `当前字段证据白名单: ${JSON.stringify(currentCompactionEvidence(session))}`,
    `turnsCovered 必须为 ${session.selectedTurnIds.length}.`,
    `resourceState: ${JSON.stringify(session.playLocalState)}`,
    `选中分支历史: ${playCompactionSource(session)}`].join('\n');
}
const NEGATED_PREFIX = /(?:不|没有?|未曾?|非|无|别|莫|勿|否|\bnot|\bnever|\bno|n't)\s*$/iu;
/** A quote only counts when some occurrence is not the tail of a negated clause ("他没有服下毒药" cannot vouch for "服下毒药"). */
function quotedVerbatim(history: string, quote: string): boolean {
  if (!quote) return false;
  for (let index = history.indexOf(quote); index >= 0; index = history.indexOf(quote, index + 1)) {
    const clause = history.slice(Math.max(0, index - 12), index).split(/[。！？!?；;，,、\n“”「」『』"]/u).at(-1) ?? '';
    if (!NEGATED_PREFIX.test(clause)) return true;
  }
  return false;
}
export function auditPlayCompaction(session: PlaySession, data: PlayCompactionData): string[] {
  const errors: string[] = [];
  const history = session.transcript.map(t => t.content).join('\n');
  if (data.turnsCovered !== session.selectedTurnIds.length) errors.push('Covered turns differ from selected branch.');
  // Canonical JSON comparison makes object key order irrelevant while retaining exact values.
  const stable = (v: unknown): string => JSON.stringify(v, (_k, value) => record(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))) : value);
  if (stable(data.resourceState) !== stable(session.playLocalState)) errors.push('Resource/state ledger changed or omitted facts.');
  for (const quote of data.chronicle) if (!quotedVerbatim(history, quote)) errors.push(`Unverified historical quote: ${quote}`);
  const factualSource = [history, session.sceneStart, session.userPersona ?? '', getPlayFrozenSystemPrompt(session)].join('\n');
  const current = currentCompactionEvidence(session);
  const verifyCurrent = (field: string, value: string, allowed: readonly string[]) => {
    if ((value === '未记录' && allowed.length > 0) || (value !== '未记录' && !allowed.includes(value))) errors.push(`Unverified current fact (${field}): ${value}`);
  };
  for (const name of Object.keys(current.characters)) if (!data.characters.some(character => character.name === name)) errors.push(`Missing current character ledger: ${name}`);
  for (const character of data.characters) {
    if (character.name !== '未记录' && !factualSource.includes(character.name) && !Object.hasOwn(current.characters, character.name)) errors.push(`Unverified character name: ${character.name}`);
    const evidence = Object.hasOwn(current.characters, character.name) ? current.characters[character.name] : undefined;
    for (const field of ['identity', 'relationshipChange', 'currentSituation'] as const) verifyCurrent(`characters.${character.name}.${field}`, character[field], evidence?.[field] ?? []);
  }
  for (const field of ['timeAndPlace', 'atmosphere', 'immediateCrisis'] as const) verifyCurrent(`currentScene.${field}`, data.currentScene[field], current.currentScene[field]);
  for (const name of data.currentScene.presentCharacters) verifyCurrent('currentScene.presentCharacters', name, current.currentScene.presentCharacters);
  for (const thread of data.unresolvedThreads) {
    if (!current.unresolvedThreads.includes(thread)) errors.push(`Unverified current unresolved thread: ${thread}`);
    if (!quotedVerbatim(history, thread)) errors.push(`Unverified historical unresolved thread: ${thread}`);
  }
  for (const name of current.currentScene.presentCharacters) if (!data.currentScene.presentCharacters.includes(name)) errors.push(`Missing current present character: ${name}`);
  for (const thread of current.unresolvedThreads) if (!data.unresolvedThreads.includes(thread)) errors.push(`Missing current unresolved thread: ${thread}`);
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
