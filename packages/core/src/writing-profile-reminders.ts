import type { NovelCopilotCapabilityId } from './novel-copilot-skill.js';
import type {
  WritingProfile,
  WritingReminderId,
} from './writing-profile.js';

export const WRITING_PROFILE_REMINDER_FRAGMENTS: Readonly<
  Record<WritingReminderId, string>
> = {
  originality: [
    'Originality reminder:',
    'Keep the premise execution, scene progression, phrasing, and imagery independently expressed and meaningfully differentiated.',
    'Do not copy identifiable wording, proprietary names, or a reference work scene sequence.',
    'This is a non-blocking writing reminder, not a similarity verdict.',
  ].join(' '),
  aiVoice: [
    'AI-voice reminder:',
    'During review or requested revision, identify mechanical sentence patterns, empty summaries, generic transitions, repetitive abstractions, and excessively symmetrical phrasing.',
    'Report concrete, non-blocking suggestions and do not rewrite prose unless the user explicitly requests a revision.',
  ].join(' '),
  characterConsistency: [
    'Character-consistency reminder:',
    'Check behavior, motivation, voice, relationships, and knowledge boundaries only against accepted character cards, relationships, and facts in the current workspace.',
    'If the current workspace has no supporting character fact, say so and do not invent a reference character baseline.',
  ].join(' '),
  adaptationFreedom: [
    'Adaptation-freedom reminder:',
    'The author may change, combine, reinterpret, or discard accepted workspace material to serve this novel.',
    'Treat current workspace Project Truth as authoritative; do not read or rely on reference source text or unadopted reference materials.',
  ].join(' '),
};

const REMINDER_CAPABILITIES: Readonly<
  Record<WritingReminderId, readonly NovelCopilotCapabilityId[]>
> = {
  originality: [
    'novel.plan_outline',
    'novel.plan_volume',
    'novel.plan_chapter',
    'novel.write_chapter',
    'novel.review_chapter',
  ],
  aiVoice: [
    'novel.review_chapter',
    'novel.revise_chapter',
  ],
  characterConsistency: [
    'novel.plan_chapter',
    'novel.write_chapter',
    'novel.review_chapter',
    'novel.generate_character_card',
    'novel.settle_chapter',
  ],
  adaptationFreedom: [
    'novel.plan_outline',
    'novel.plan_volume',
    'novel.plan_chapter',
    'novel.generate_character_card',
  ],
};

export function selectWritingReminderIds(
  profile: WritingProfile,
  capability: NovelCopilotCapabilityId | undefined,
): WritingReminderId[] {
  if (!capability) {
    return [];
  }

  return (Object.keys(REMINDER_CAPABILITIES) as WritingReminderId[])
    .filter((reminder) =>
      profile.writingReminders[reminder]
      && REMINDER_CAPABILITIES[reminder].includes(capability));
}

export function formatWritingProfileReminders(
  profile: WritingProfile,
  capability: NovelCopilotCapabilityId | undefined,
): string | undefined {
  const reminders = selectWritingReminderIds(profile, capability);
  if (!reminders.length) {
    return undefined;
  }

  return [
    'Apply only the following fixed, non-blocking Writing reminders.',
    'They do not authorize direct writes, do not change PendingAction approval, and do not add new context sources.',
    '',
    ...reminders.map((reminder) =>
      `- ${WRITING_PROFILE_REMINDER_FRAGMENTS[reminder]}`),
  ].join('\n');
}
