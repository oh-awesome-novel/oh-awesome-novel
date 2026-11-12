import type { TextBeat } from '@oh-awesome-novel/core/text-speaker-parser';

/** One sentence on the stage. `player` marks the author's own action. */
export type StageBeat = TextBeat & { player?: boolean };

/** Stage text is always rendered as plain text; inline markup is dropped. */
export function plainStageText(text: string | undefined): string {
  return (text ?? '').replace(/<[^>]*>/g, '').replace(/\*\*/g, '');
}

/** Name plate colour derived from the speaker's name, used when the roster gives none. */
export function hashedSpeakerColor(speaker: string): string {
  let hue = 0;
  for (const char of speaker) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hue} 65% 76%)`;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}
