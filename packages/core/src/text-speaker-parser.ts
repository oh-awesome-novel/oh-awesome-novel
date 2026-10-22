// Inspired by CicaTavern's VN grammar. MIT attribution: licenses/CicaTavern-MIT.txt.
export interface SpeakerIdentity { id: string; name: string; aliases: string[] }
export interface TextBeat { speaker: string; text: string; isDialogue: boolean }
export interface StageSnapshot { sceneId: string; backgroundDataUrl?: string; activeCharacters: Array<{ characterId: string; position: 'left' | 'center' | 'right'; portraitDataUrl?: string }>; beats: TextBeat[] }
const NOT_NAME = /沉默|片刻|忽然|突然|笑得|然后|一会|半晌|声音|心里|[了着得]|^[她他你我]/;
const roles = ['掌柜', '店小二', '老伯', '侍女'];
export function inferSpeaker(context: string, roster: readonly SpeakerIdentity[] = []): string {
  const candidates = roster.flatMap(c => [c.name, ...c.aliases].map(name => ({ name, id: c.id })));
  const matches = candidates.filter(c => context.includes(c.name));
  const distinct = [...new Set(matches.map(c => c.id))];
  if (distinct.length === 1) return distinct[0]!;
  const role = roles.find(name => context.includes(name));
  if (role) return role;
  const match = context.match(/(?:^|[，。！？\s])([\u4e00-\u9fff]{2,4}?)(?:轻声|低声|小声|苦笑|笑着|缓缓|冷冷)?(?:说|道|问|喊|答)/);
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
export function createStageSnapshot(sceneId: string, text: string, characters: readonly SpeakerIdentity[] = [], portraits: Record<string, string> = {}, backgrounds: Record<string, string> = {}): StageSnapshot {
  return { sceneId, ...(Object.hasOwn(backgrounds, sceneId) ? { backgroundDataUrl: backgrounds[sceneId] } : {}), activeCharacters: characters.map((c, i) => ({ characterId: c.id, ...(portraits[c.id] ? { portraitDataUrl: portraits[c.id] } : {}), position: i === 0 ? 'center' : i % 2 ? 'left' : 'right' })), beats: parseTextBeats(text, characters) };
}
export function normalizeStageSnapshot(value: unknown): StageSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid stage snapshot.');
  const v = value as StageSnapshot;
  if (v.backgroundDataUrl !== undefined && (typeof v.backgroundDataUrl !== 'string' || v.backgroundDataUrl.length > 350000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.backgroundDataUrl))) throw new Error('Invalid stage background.');
  if (typeof v.sceneId !== 'string' || v.sceneId.length > 20000 || !Array.isArray(v.activeCharacters) || v.activeCharacters.length > 100 || !v.activeCharacters.every(c => c && typeof c.characterId === 'string' && c.characterId.length <= 300 && ['left', 'center', 'right'].includes(c.position) && (c.portraitDataUrl === undefined || (typeof c.portraitDataUrl === 'string' && c.portraitDataUrl.length <= 350000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.portraitDataUrl)))) || !Array.isArray(v.beats) || v.beats.length > 20000 || !v.beats.every(b => b && typeof b.speaker === 'string' && b.speaker.length <= 300 && typeof b.text === 'string' && b.text.length <= 200000 && typeof b.isDialogue === 'boolean')) throw new Error('Invalid stage snapshot.');
  return structuredClone(v);
}
