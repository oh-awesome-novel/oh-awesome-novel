// Inspired by CicaTavern's VN grammar. MIT attribution: licenses/CicaTavern-MIT.txt.
export interface SpeakerIdentity { id: string; name: string; aliases: string[] }
export interface TextBeat { speaker: string; text: string; isDialogue: boolean }
/**
 * A turn's frozen stage. Images are referenced by id and resolved from the
 * session's launch-time scenery/portrait snapshot, so turns stay small; the
 * inline data URL fields remain readable for turns written before references.
 */
export interface StageSnapshot { sceneId: string; backgroundId?: string; backgroundDataUrl?: string; activeCharacters: Array<{ characterId: string; name?: string; position: 'left' | 'center' | 'right'; portraitDataUrl?: string }>; beats: TextBeat[] }
// Adapted from CicaTavern's VN grammar (MIT): common narrative words that precede 说/道 but are not names.
const NOT_NAME = /.[了着得]|[地很太才却还便就把被像嘴话]|沉默|片刻|半晌|良久|一会|一下|一眼|一[行句声]|忽然|突然|随即|然后|于是|最后|最终|终于|随后|之后|起来|下来|过来|出来|回来|点头|摇头|抬头|低头|抬眼|转身|开口|眼睛|声音|心里|心中|内心|想法|默念|笑得|^[她他你我它您]/;
// Unnamed people the story calls by their trade get a name plate of their own.
const roles = ['店小二', '老板娘', '掌柜', '小二', '伙计', '老板', '老头', '老汉', '老伯', '大爷', '大娘', '婆婆', '老妇人', '郎中', '管家', '侍卫', '守卫', '衙役', '捕快', '车夫', '船夫', '丫鬟', '侍女', '和尚'];
export function inferSpeaker(context: string, roster: readonly SpeakerIdentity[] = []): string {
  const candidates = roster.flatMap(c => [c.name, ...c.aliases].map(name => ({ name, id: c.id })));
  const matches = candidates.filter(c => context.includes(c.name));
  const distinct = [...new Set(matches.map(c => c.id))];
  // The name plate shows the roster's display name, not its file id.
  if (distinct.length === 1) return roster.find(c => c.id === distinct[0])!.name;
  const role = roles.find(name => context.includes(name));
  if (role) return role;
  const match = context.match(/(?:^|[，。！？\s])([\u4e00-\u9fff]{2,4}?)(?:轻声|低声|小声|大声|苦笑|笑着|忍不住|如实|继续|(?:缓缓|慢慢|轻轻|淡淡|冷冷|静静|悄悄|默默|喃喃|幽幽)地?)?(?:笑道|问道|答道|喊道|叫道|说|道|问|喊|答|叫)/);
  return match?.[1] && !NOT_NAME.test(match[1]) ? match[1] : '';
}
/** Balance inline markup at beat boundaries. Callers render plain text, never raw HTML. */
export function carryTags(lines: string[]): string[] {
  let open: string[] = [];
  let bold = false;
  return lines.map(line => {
    const prefix = open.map(tag => `<${tag}>`).join('') + (bold ? '**' : '');
    for (const tag of line.matchAll(/<(\/?)(b|strong|i|em|u|s|code|span)>/g)) {
      if (tag[1]) { const index = open.lastIndexOf(tag[2]!); if (index >= 0) open.splice(index, 1); }
      else open.push(tag[2]!);
    }
    if ((line.match(/\*\*/g)?.length ?? 0) % 2) bold = !bold;
    return prefix + line + (bold ? '**' : '') + [...open].reverse().map(tag => `</${tag}>`).join('');
  });
}
export function parseTextBeats(text: string, roster: readonly SpeakerIdentity[] = []): TextBeat[] {
  const chunks = text.match(/[^。！？!?…\n]+[。！？!?…]*(?:[”」』])?|[。！？!?…]+/g) ?? [];
  const balanced = carryTags(chunks);
  let inQuote = false;
  let lastSpeaker = '';
  return chunks.map((chunk, index) => {
    const isDialogue = inQuote || /[“”「」『』"]/.test(chunk);
    const before = chunk.split(/[“「『"]/)[0] ?? '';
    const after = chunk.split(/[”」』"]/).at(-1) ?? '';
    const next = chunks[index + 1]?.split(/[“「『"]/)[0] ?? '';
    const speaker = isDialogue ? inferSpeaker(before, roster) || inferSpeaker(after, roster) || inferSpeaker(next, roster) || (inQuote ? lastSpeaker : '') : '';
    for (const char of chunk) { if ('“「『'.includes(char)) inQuote = true; if ('”」』'.includes(char)) inQuote = false; }
    lastSpeaker = speaker;
    return { text: balanced[index]!.trim(), isDialogue, speaker };
  }).filter(beat => Boolean(beat.text));
}
const MAX_STAGE_SCENE_LABEL = 120;
const MAX_STAGE_CHARACTERS = 100;
const MAX_STAGE_BEATS = 20_000;
const MAX_STAGE_BEAT_TEXT = 200_000;
/** Scene prose can be long; the stage header only needs its first line. */
export function stageSceneLabel(scene: string): string {
  const line = scene.split(/\r?\n/).map(item => item.trim()).find(Boolean) ?? '';
  const chars = [...line];
  return chars.length > MAX_STAGE_SCENE_LABEL ? `${chars.slice(0, MAX_STAGE_SCENE_LABEL - 1).join('')}…` : line;
}
function boundStageBeats(beats: TextBeat[]): TextBeat[] {
  const split = beats.flatMap(beat => {
    if (beat.text.length <= MAX_STAGE_BEAT_TEXT) return [beat];
    const pieces: TextBeat[] = [];
    for (let start = 0; start < beat.text.length; start += MAX_STAGE_BEAT_TEXT) pieces.push({ ...beat, text: beat.text.slice(start, start + MAX_STAGE_BEAT_TEXT) });
    return pieces;
  });
  if (split.length <= MAX_STAGE_BEATS) return split;
  // Too many short beats: pack neighbours so the snapshot stays readable without losing prose.
  const group = Math.ceil(split.length / MAX_STAGE_BEATS);
  const packed: Array<{ beat: TextBeat; count: number }> = [];
  for (const beat of split) {
    const last = packed.at(-1);
    if (last && last.count < group && last.beat.text.length + beat.text.length <= MAX_STAGE_BEAT_TEXT) {
      last.beat = { speaker: last.beat.speaker === beat.speaker ? beat.speaker : '', text: last.beat.text + beat.text, isDialogue: last.beat.isDialogue || beat.isDialogue };
      last.count += 1;
    } else packed.push({ beat, count: 1 });
  }
  return packed.map(item => item.beat);
}
const STAGE_POSITIONS: Record<number, Array<'left' | 'center' | 'right'>> = { 1: ['center'], 2: ['left', 'right'], 3: ['left', 'center', 'right'] };
/** Roster characters named, aliased or speaking in this turn, in order of first appearance. */
function presentCharacters(text: string, beats: readonly TextBeat[], characters: readonly SpeakerIdentity[]): SpeakerIdentity[] {
  const first = (character: SpeakerIdentity): number => {
    const spoken = beats.findIndex(beat => beat.speaker === character.name);
    const named = Math.min(...[character.name, ...character.aliases].filter(Boolean).map(name => text.indexOf(name)).filter(index => index >= 0));
    return Number.isFinite(named) ? named : spoken >= 0 ? text.length + spoken : -1;
  };
  return characters.map(character => ({ character, at: first(character) })).filter(item => item.at >= 0)
    .sort((a, b) => a.at - b.at).slice(0, MAX_STAGE_CHARACTERS).map(item => item.character);
}
/** Always returns a snapshot that normalizeStageSnapshot accepts, or throws before the caller commits it. */
export function createStageSnapshot(sceneId: string, text: string, characters: readonly SpeakerIdentity[] = [], backgrounds: Readonly<Record<string, string>> = {}): StageSnapshot {
  const beats = boundStageBeats(parseTextBeats(text, characters));
  const present = presentCharacters(text, beats, characters);
  const positions = STAGE_POSITIONS[present.length];
  return normalizeStageSnapshot({ sceneId: stageSceneLabel(sceneId), ...(Object.hasOwn(backgrounds, sceneId) ? { backgroundId: sceneId } : {}),
    activeCharacters: present.map((c, i) => ({ characterId: c.id, name: c.name, position: positions?.[i] ?? (['left', 'center', 'right'] as const)[i % 3]! })), beats });
}
export function normalizeStageSnapshot(value: unknown): StageSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid stage snapshot.');
  const v = value as StageSnapshot;
  if (v.backgroundDataUrl !== undefined && (typeof v.backgroundDataUrl !== 'string' || v.backgroundDataUrl.length > 350000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.backgroundDataUrl))) throw new Error('Invalid stage background.');
  if (v.backgroundId !== undefined && (typeof v.backgroundId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(v.backgroundId))) throw new Error('Invalid stage background.');
  if (typeof v.sceneId !== 'string' || v.sceneId.length > 20000 || !Array.isArray(v.activeCharacters) || v.activeCharacters.length > 100 || !v.activeCharacters.every(c => c && typeof c.characterId === 'string' && c.characterId.length <= 300 && (c.name === undefined || (typeof c.name === 'string' && c.name.length <= 300)) && ['left', 'center', 'right'].includes(c.position) && (c.portraitDataUrl === undefined || (typeof c.portraitDataUrl === 'string' && c.portraitDataUrl.length <= 350000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.portraitDataUrl)))) || !Array.isArray(v.beats) || v.beats.length > 20000 || !v.beats.every(b => b && typeof b.speaker === 'string' && b.speaker.length <= 300 && typeof b.text === 'string' && b.text.length <= 200000 && typeof b.isDialogue === 'boolean')) throw new Error('Invalid stage snapshot.');
  return structuredClone(v);
}
