import { locateTextBeats } from './text-speaker-parser.js';
import type { StageSnapshot } from './text-speaker-parser.js';

/**
 * Optional stage markup (task 1610). A session opts in at creation; the referee then
 * tags each spoken line with its speaker and, optionally, a prepared portrait:
 *
 *   @nian[angry] “你又迟到了！”
 *
 * The host removes the tags before anything is shown or saved. They only describe
 * who speaks and which portrait is on stage; they never carry facts or state.
 */
export const PLAY_STAGE_MARKUP_METADATA_KEY = 'vnStageMarkup' as const;
export const PLAY_STAGE_MARKUP_VERSION = 1 as const;
export const PLAY_STAGE_MARKUP_PROTOCOL_MARKER = '## 演出标注 (stage markup)';

export interface PlayStageMarkupConfig { version: typeof PLAY_STAGE_MARKUP_VERSION }

export interface PlayStageCastPortrait { id: string; label: string; description: string; usage?: string }
export interface PlayStageCastMember {
  id: string;
  name: string;
  aliases: string[];
  portraits?: { default: string; items: PlayStageCastPortrait[] };
}

/** What one tagged line resolved to. */
export interface PlayStageMarkupLine { speakerId: string; speaker: string; portraitId?: string }
export type PlayStageMarkupNoticeKind = 'unknownCharacter' | 'unknownPortrait' | 'malformed';
/** One entry per kind of fallback in a turn. */
export interface PlayStageMarkupNotice { kind: PlayStageMarkupNoticeKind; count: number; sample: string }
export interface ParsedPlayStageMarkup {
  /** The narrative without tags. */
  text: string;
  /** Per line of `text`: the tag it carried, when it resolved to a cast member. */
  lines: Array<PlayStageMarkupLine | undefined>;
  notices: PlayStageMarkupNotice[];
}

const MAX_PROMPT_DESCRIPTION = 160;
const MAX_PROMPT_USAGE = 80;
const MAX_NOTICE_SAMPLE = 80;
const TAG_START = /^[@＠]/u;
const NAME_END = /^(?:$|[\s[［:：“”「」『』"])/u;
const GENERIC_NAME = /^[^\s[\]［］:：“”「」『』"@＠]{1,64}/u;
const PORTRAIT_ID = /^[A-Za-z0-9_-]{1,32}$/;

export function readPlayStageMarkup(metadataExtensions: Readonly<Record<string, unknown>> | undefined): PlayStageMarkupConfig | undefined {
  const value = metadataExtensions?.[PLAY_STAGE_MARKUP_METADATA_KEY];
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { version?: unknown }).version !== PLAY_STAGE_MARKUP_VERSION
    || Object.keys(value).some(key => key !== 'version')) {
    throw new Error('Unsupported Play stage markup metadata.');
  }
  return { version: PLAY_STAGE_MARKUP_VERSION };
}

function text(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()); }

/** The characters and prepared portraits the session recorded at creation. */
export function readPlayStageCast(metadataExtensions: Readonly<Record<string, unknown>> | undefined, characters: readonly string[] = []): PlayStageCastMember[] {
  const roster = metadataExtensions?.characterRoster;
  const sets = metadataExtensions?.characterPortraitSets;
  const portraitSets = sets && typeof sets === 'object' && !Array.isArray(sets) ? sets as Record<string, unknown> : {};
  const members: PlayStageCastMember[] = Array.isArray(roster)
    ? roster.flatMap((item): PlayStageCastMember[] => item && typeof item === 'object' && text(item.id) && text(item.name)
      ? [{ id: item.id, name: item.name, aliases: Array.isArray(item.aliases) ? item.aliases.filter(text) : [] }] : [])
    : characters.filter(text).map(name => ({ id: name, name, aliases: [] }));
  return members.map((member) => {
    const set = portraitSets[member.id] as { default?: unknown; items?: unknown } | undefined;
    const items = Array.isArray(set?.items)
      ? set.items.flatMap((item): PlayStageCastPortrait[] => item && typeof item === 'object' && typeof item.id === 'string' && PORTRAIT_ID.test(item.id)
        ? [{ id: item.id, label: text(item.label) ? item.label : item.id, description: text(item.description) ? item.description : '', ...(text(item.usage) ? { usage: item.usage } : {}) }] : [])
      : [];
    if (!items.length) return member;
    const fallback = typeof set?.default === 'string' && items.some(item => item.id === set.default) ? set.default : items[0]!.id;
    return { ...member, portraits: { default: fallback, items } };
  });
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/gu, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat;
}

/** The block appended once to the frozen prefix of a session that enabled stage markup. */
export function formatPlayStageMarkupFrozenProtocol(cast: readonly PlayStageCastMember[]): string {
  return [
    PLAY_STAGE_MARKUP_PROTOCOL_MARKER,
    'In the player-visible narrative, start every line of spoken dialogue with a speaker tag: `@<character id>[<portrait id>] “台词”`. The portrait part is optional: `@<character id> “台词”`.',
    '- One speaker per tagged line. Narration, action and thoughts go on their own untagged lines.',
    '- Use only the character ids and portrait ids listed below. A speaker who is not listed (a passer-by, an unnamed role) is written as ordinary prose without a tag.',
    '- Choose the portrait whose description or usage fits the moment; leave the portrait out to keep the current one.',
    '- A tag only says who speaks and which portrait is shown. It never carries facts, state or hidden information, and never appears inside the settlement block.',
    '- The host removes the tags before the player reads the text. Earlier assistant messages show them the same way.',
    'Cast:',
    ...(cast.length ? cast.flatMap(member => [
      `- @${member.id} — ${member.name}${member.aliases.length ? `（${member.aliases.join('、')}）` : ''}${member.portraits ? `; default portrait: ${member.portraits.default}` : '; no prepared portraits'}`,
      ...(member.portraits?.items ?? []).map(item =>
        `  - [${item.id}] ${item.label}: ${clip(item.description, MAX_PROMPT_DESCRIPTION)}${item.usage ? ` (use: ${clip(item.usage, MAX_PROMPT_USAGE)})` : ''}`),
    ]) : ['- none; write every line without a tag.']),
  ].join('\n');
}

interface CastName { name: string; member: PlayStageCastMember | undefined }
function castNames(cast: readonly PlayStageCastMember[]): CastName[] {
  const byName = new Map<string, PlayStageCastMember | undefined>();
  for (const member of cast) {
    for (const name of new Set([member.id, member.name, ...member.aliases].filter(Boolean))) {
      // A name two characters share cannot identify either of them.
      byName.set(name, byName.has(name) ? undefined : member);
    }
  }
  return [...byName].map(([name, member]) => ({ name, member })).sort((a, b) => b.name.length - a.name.length);
}

type LineResult =
  | { kind: 'plain'; text: string }
  | { kind: 'tagged'; text: string; line: PlayStageMarkupLine; unknownPortrait?: string }
  | { kind: 'unknownCharacter'; text: string; name: string }
  | { kind: 'malformed'; text: string };

function parseLine(raw: string, names: readonly CastName[]): LineResult {
  const trimmed = raw.trimStart();
  if (!TAG_START.test(trimmed)) return { kind: 'plain', text: raw };
  const body = trimmed.slice(1);
  const known = names.find(item => body.startsWith(item.name) && NAME_END.test(body.slice(item.name.length)));
  const name = known?.name ?? GENERIC_NAME.exec(body)?.[0];
  // Whatever is left of a broken tag is dropped, so no raw marker reaches the reader.
  const malformed = (): LineResult => ({
    kind: 'malformed',
    text: body.replace(/^[^\s[［“「『"]*/u, '').replace(/^[[［][^\]］\s“「『"]*[\]］]?/u, '').trim(),
  });
  if (!name) return malformed();
  let rest = body.slice(name.length);
  let portrait: string | undefined;
  if (/^[[［]/u.test(rest)) {
    const bracket = /^[[［]([^\]］\n]{0,64})[\]］]/u.exec(rest);
    if (!bracket) return malformed();
    portrait = bracket[1]!.trim();
    rest = rest.slice(bracket[0].length);
  }
  const spoken = rest.replace(/^\s*[:：]?\s*/u, '').trimEnd();
  if (!known?.member) return { kind: 'unknownCharacter', text: spoken, name };
  const member = known.member;
  if (portrait === undefined) return { kind: 'tagged', text: spoken, line: { speakerId: member.id, speaker: member.name } };
  if (member.portraits?.items.some(item => item.id === portrait)) {
    return { kind: 'tagged', text: spoken, line: { speakerId: member.id, speaker: member.name, portraitId: portrait } };
  }
  return {
    kind: 'tagged', text: spoken, unknownPortrait: `${member.id}[${portrait}]`,
    line: { speakerId: member.id, speaker: member.name, ...(member.portraits ? { portraitId: member.portraits.default } : {}) },
  };
}

class NoticeLog {
  private readonly entries = new Map<PlayStageMarkupNoticeKind, PlayStageMarkupNotice>();
  add(kind: PlayStageMarkupNoticeKind, sample: string): void {
    const entry = this.entries.get(kind);
    if (entry) entry.count += 1;
    else this.entries.set(kind, { kind, count: 1, sample: clip(sample, MAX_NOTICE_SAMPLE) });
  }
  record(result: LineResult, raw: string): void {
    if (result.kind === 'unknownCharacter') this.add('unknownCharacter', result.name);
    else if (result.kind === 'malformed') this.add('malformed', raw.trim());
    else if (result.kind === 'tagged' && result.unknownPortrait) this.add('unknownPortrait', result.unknownPortrait);
  }
  list(): PlayStageMarkupNotice[] { return [...this.entries.values()].map(entry => ({ ...entry })); }
}

/**
 * Removes the tags from a whole narrative. Fallbacks never fail the turn: an unknown
 * character leaves the line to the usual speaker inference, an unknown portrait falls
 * back to the character's default, and a broken tag makes the line narration.
 */
export function parsePlayStageMarkup(narrative: string, cast: readonly PlayStageCastMember[]): ParsedPlayStageMarkup {
  const names = castNames(cast);
  const notices = new NoticeLog();
  const texts: string[] = [];
  const lines: Array<PlayStageMarkupLine | undefined> = [];
  for (const raw of narrative.split(/\r?\n/u)) {
    const result = parseLine(raw, names);
    notices.record(result, raw);
    // A tag with nothing after it leaves no line behind.
    if (result.kind !== 'plain' && !result.text) continue;
    texts.push(result.text);
    lines.push(result.kind === 'tagged' ? result.line : undefined);
  }
  while (texts.length && !texts[0]!.trim()) { texts.shift(); lines.shift(); }
  while (texts.length && !texts.at(-1)!.trim()) { texts.pop(); lines.pop(); }
  return { text: texts.join('\n').trim(), lines, notices: notices.list() };
}

export interface PlayStageMarkupDraftLine extends PlayStageMarkupLine { line: number }
export interface PlayStageMarkupDraftReader {
  /**
   * Strips one released piece of draft text. A piece may end in the middle of an untagged
   * line, but a tagged line must arrive whole. `lines` index the draft text released so far.
   */
  push(piece: string): { text: string; lines: PlayStageMarkupDraftLine[] };
  reset(): void;
}

/** Strips tags from draft text as it is released, so no draft ever shows a raw tag. */
export function createPlayStageMarkupDraftReader(cast: readonly PlayStageCastMember[]): PlayStageMarkupDraftReader {
  const names = castNames(cast);
  let atLineStart = true;
  let lineIndex = 0;
  return {
    push(piece) {
      const out: string[] = [];
      const lines: PlayStageMarkupDraftLine[] = [];
      const parts = piece.split('\n');
      parts.forEach((part, index) => {
        const terminated = index < parts.length - 1;
        if (!part && !terminated) return;
        const raw = part.replace(/\r$/u, '');
        const result = atLineStart ? parseLine(raw, names) : { kind: 'plain' as const, text: raw };
        if (result.kind !== 'plain' && !result.text) return;
        if (result.kind === 'tagged') lines.push({ line: lineIndex, ...result.line });
        out.push(terminated ? `${result.text}\n` : result.text);
        if (terminated) lineIndex += 1;
        atLineStart = terminated;
      });
      return { text: out.join(''), lines };
    },
    reset() { atLineStart = true; lineIndex = 0; },
  };
}

/**
 * Puts the tags back on a committed turn for the model's history, from the saved
 * snapshot alone: only lines whose first sentence was tagged get one. Returns the
 * content unchanged when the snapshot does not line up with it.
 */
export function restorePlayStageMarkup(content: string, snapshot: StageSnapshot | undefined): string {
  if (!snapshot?.beats.some(beat => beat.source === 'markup')) return content;
  const located = locateTextBeats(content);
  if (located.length !== snapshot.beats.length) return content;
  const lines = content.split('\n');
  const tagged = new Set<number>();
  located.forEach((line, index) => {
    const beat = snapshot.beats[index]!;
    if (tagged.has(line)) return;
    tagged.add(line);
    if (beat.source !== 'markup' || !beat.speakerId || lines[line] === undefined) return;
    lines[line] = `@${beat.speakerId}${beat.portraitId ? `[${beat.portraitId}]` : ''} ${lines[line]}`;
  });
  return lines.join('\n');
}
