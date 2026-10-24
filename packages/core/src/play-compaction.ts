import { createHash } from 'node:crypto';
import type { PlaySession } from './play-session.js';
import { getPlayFrozenSystemPrompt } from './play-turn-prompt.js';

export interface PlayCompactionData {
  version: 1;
  turnsCovered: number;
  /** `quote` is the verbatim history that backs any field the host state does not record. */
  characters: Array<{ name: string; identity: string; relationshipChange: string; currentSituation: string; quote?: string }>;
  /** Distilled facts in order, each backed by a short verbatim quote from the selected history. */
  chronicle: PlayCompactionChronicleEntry[];
  unresolvedThreads: string[];
  currentScene: { timeAndPlace: string; presentCharacters: string[]; atmosphere: string; immediateCrisis: string; quote?: string };
  voiceAndStyle: { pov: string; rhythm: string; tonePoints: string[] };
  /** Exact host state is carried independently of model prose, including costs and injuries. */
  resourceState: Record<string, unknown>;
}
export interface PlayCompactionChronicleEntry { fact: string; quote: string }
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
const optionalQuote = (v: unknown): { quote?: string } => v === undefined ? {} : { quote: text(v) };
/** A bare string is its own quote (archives written before entries carried both). */
function chronicleEntry(v: unknown): PlayCompactionChronicleEntry {
  if (typeof v === 'string') return { fact: text(v), quote: v };
  if (!record(v)) throw new Error('Invalid archive chronicle entry.');
  return { fact: text(v.fact), quote: text(v.quote) };
}
export function parsePlayCompaction(response: string): PlayCompactionData {
  if (response.length > 200_000) throw new Error('Archive exceeds size limit.');
  const match = /<剧情存档\s*>([\s\S]*?)(?:<\/剧情存档\s*>|$)/u.exec(response.trim());
  const raw = (match?.[1] ?? response).trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
  const v: unknown = JSON.parse(raw);
  if (!record(v) || v.version !== 1 || !Number.isInteger(v.turnsCovered) || (v.turnsCovered as number) < 1 || !Array.isArray(v.characters) || !record(v.currentScene) || !record(v.voiceAndStyle) || !record(v.resourceState)) throw new Error('Invalid five-dimension archive.');
  return { version: 1, turnsCovered: v.turnsCovered as number,
    characters: v.characters.map(c => { if (!record(c)) throw new Error('Invalid archive character.'); return { name: text(c.name), identity: text(c.identity), relationshipChange: text(c.relationshipChange), currentSituation: text(c.currentSituation), ...optionalQuote(c.quote) }; }),
    chronicle: (Array.isArray(v.chronicle) ? v.chronicle : list(v.chronicle)).map(chronicleEntry), unresolvedThreads: list(v.unresolvedThreads),
    currentScene: { timeAndPlace: text(v.currentScene.timeAndPlace), presentCharacters: list(v.currentScene.presentCharacters), atmosphere: text(v.currentScene.atmosphere), immediateCrisis: text(v.currentScene.immediateCrisis), ...optionalQuote(v.currentScene.quote) },
    voiceAndStyle: { pov: text(v.voiceAndStyle.pov), rhythm: text(v.voiceAndStyle.rhythm), tonePoints: list(v.voiceAndStyle.tonePoints) }, resourceState: v.resourceState,
  };
}
export function playCompactionSource(session: PlaySession): string {
  return JSON.stringify({ ids: session.selectedTurnIds, state: session.playLocalState, events: session.events.filter(e => session.turnArtifacts.filter(t => session.selectedTurnIds.includes(t.id)).some(t => t.eventIds.includes(e.id))), messages: session.transcript });
}
/** The archive prompt's branch facts; the messages travel once as conversation history. */
function playCompactionPromptSource(session: PlaySession): string {
  return JSON.stringify({ ids: session.selectedTurnIds, events: session.events.filter(e => session.turnArtifacts.filter(t => session.selectedTurnIds.includes(t.id)).some(t => t.eventIds.includes(e.id))) });
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
    'JSON: {version:1, turnsCovered:number, characters:[{name,identity,relationshipChange,currentSituation,quote?}], chronicle:[{fact,quote}], unresolvedThreads:string[], currentScene:{timeAndPlace,presentCharacters:string[],atmosphere,immediateCrisis,quote?}, voiceAndStyle:{pov,rhythm,tonePoints:string[]}, resourceState:object}.',
    '提炼而不是摘抄：chronicle 按时间顺序写关键事实 fact（保留地点、道具、数字、约定和关键台词），每条附 quote：能在上面历史里逐字找到的一小段原文（30字以内），作为这条事实的依据。',
    '人物与当前场景：下方对应角色、对应字段的当前证据白名单里有值的字段必须逐字使用白名单的值，不得改写或填 未记录；白名单没有记录的字段可以根据历史提炼，但该人物（或 currentScene）必须附 quote，即历史里逐字存在的一小段原文；无从判断时填 未记录。presentCharacters 只能从白名单选择，无记录填空数组。不得把已经改变的健康、资源、关系或旧危机当成当前事实。所有当前角色都要保留。',
    'unresolvedThreads 只能且必须包含白名单里全部历史存在逐字引文的未结线索；缺少字面历史依据必须报错修正，不得补写或静默省略。不得把已经解决的旧承诺列为未结线索。resourceState 必须逐项完整保留当前状态，包括不可逆伤势、已消耗资源与未兑现约定。',
    `当前字段证据白名单: ${JSON.stringify(currentCompactionEvidence(session))}`,
    `turnsCovered 必须为 ${session.selectedTurnIds.length}.`,
    `resourceState: ${JSON.stringify(session.playLocalState)}`,
    `选中分支事件: ${playCompactionPromptSource(session)}`].join('\n');
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
  const verifiedQuote = (quote: string | undefined): boolean => Boolean(quote) && [...quote!].length <= 80 && quotedVerbatim(history, quote!);
  for (const raw of data.chronicle) {
    const entry = chronicleEntry(raw);
    if (!verifiedQuote(entry.quote)) errors.push(`Unverified historical quote: ${entry.quote}`);
  }
  const factualSource = [history, session.sceneStart, session.userPersona ?? '', getPlayFrozenSystemPrompt(session)].join('\n');
  const current = currentCompactionEvidence(session);
  // Host state is binding where it records a field; elsewhere a distilled value needs a verbatim quote.
  const verifyCurrent = (field: string, value: string, allowed: readonly string[], quoted: boolean) => {
    if (allowed.length ? !allowed.includes(value) : value !== '未记录' && !quoted) errors.push(`Unverified current fact (${field}): ${value}`);
  };
  for (const name of Object.keys(current.characters)) if (!data.characters.some(character => character.name === name)) errors.push(`Missing current character ledger: ${name}`);
  for (const character of data.characters) {
    if (character.name !== '未记录' && !factualSource.includes(character.name) && !Object.hasOwn(current.characters, character.name)) errors.push(`Unverified character name: ${character.name}`);
    const evidence = Object.hasOwn(current.characters, character.name) ? current.characters[character.name] : undefined;
    const quoted = verifiedQuote(character.quote);
    for (const field of ['identity', 'relationshipChange', 'currentSituation'] as const) verifyCurrent(`characters.${character.name}.${field}`, character[field], evidence?.[field] ?? [], quoted);
  }
  const sceneQuoted = verifiedQuote(data.currentScene.quote);
  for (const field of ['timeAndPlace', 'atmosphere', 'immediateCrisis'] as const) verifyCurrent(`currentScene.${field}`, data.currentScene[field], current.currentScene[field], sceneQuoted);
  for (const name of data.currentScene.presentCharacters) if (!current.currentScene.presentCharacters.includes(name)) errors.push(`Unverified current fact (currentScene.presentCharacters): ${name}`);
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
