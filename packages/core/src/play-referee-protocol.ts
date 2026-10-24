/**
 * Turn-invariant world referee rules. The frozen system prefix carries them once;
 * a session whose stored prefix predates the marker still receives them in the tail.
 */
export const PLAY_REFEREE_PROTOCOL_MARKER = '## 每轮回复都要遵守 (world referee protocol)';

export const PLAY_REFEREE_INTRO_RULES = [
  'Run a roleplay sandbox turn inside the OAN novel world.',
  'Use one world referee with character voice/state modules; do not spawn a multi-agent runtime.',
  'Play-local state and transcript are not canonical truth.',
  'The world is not inert: resolve consequences that follow from time, prior events, NPC intent, and world rules.',
  'Every external event requires a concise causal reason. Do not invent unrelated drama.',
  'Do not call canonical write tools. Return Play-local narrative and settlement only.',
] as const;

export const PLAY_REFEREE_REVEAL_RULE = 'To reveal one candidate, emit exactly one knowledgeChanges revealEvent item and exactly one current informationSpread event at the same target visibility whose cause.sourceEventIds contains that subjectEventId. Never copy hidden source details into Player-facing prose.';
export const PLAY_REFEREE_CUE_RULE = 'A settlement event that realizes one of these cues must set its listed cause.pressureId or cause.agendaId. Do not invent momentum ids. A cue may be realized at most once this turn.';
export const PLAY_REFEREE_HARD_DUE_RULE = 'Every listed hard-due event must appear exactly once in settlement.events with cause.triggerId set to its id. Hard-due events do not consume the external-event budget.';

export const PLAY_REFEREE_OUTPUT_PROTOCOL = [
  'Output protocol:',
  '1. Write only the player-visible narrative first. Never leak playerUnknown events.',
  '2. End with exactly one fenced `oan-play-settlement` JSON object.',
  '3. The JSON fields are: elapsed, worldTimeAnchor, events, pressureChanges, agendaChanges, scheduledEventChanges, knowledgeChanges, stateDelta, observations, suggestedActions.',
  '4. Each event contains kind, origin, title, summary, visibility, and cause: { reason, optional pressureId or agendaId }. Momentum ids must come from the host-eligible list.',
  '5. To create a future consequence, add a scheduledEventChanges item with type schedule, label, trigger, template, reason, and optional priority. To cancel or reschedule a pending item, reference its scheduledEventId and provide a reason.',
  'Absolute schedules opt in with trigger.format iso8601 and an ISO 8601 date-time including timezone (Z or ±HH:mm). Only an equally explicit ISO world clock anchor is comparable. Unformatted legacy or natural-language time remains pending. Hard-due evaluation uses the committed before-turn anchor.',
  'For each event-caused state change, include event.stateDeltaRefs with safe dotted leaf paths into this turn stateDelta (for example station.gates). Each reference must name a value that actually changes from the before-state; do not cite unchanged, unknown, reserved worldMomentum/playKnowledge, or another turn state.',
  '6. Update an existing pressure or agenda only through pressureChanges / agendaChanges. Each change needs its id, reason, and at least one changed field; every event that cites a pressureId or agendaId must include the matching change. Never write worldMomentum or playKnowledge through stateDelta and never invent a new momentum id.',
  '7. Do not include event ids, turn ids, sequence, timestamps, or canonical flags; the host assigns them.',
  '8. After the turn, observations remain Play-local. Do not adopt them into canon without PendingAction.',
  '9. Player-visible or rumor summaries and observation evidence may describe only perceivable consequences. Keep hidden causal reasoning in event cause and mark truly secret facts playerUnknown.',
] as const;

/** The block appended once to the frozen prefix. */
export function formatPlayRefereeFrozenProtocol(): string {
  return [
    PLAY_REFEREE_PROTOCOL_MARKER,
    ...PLAY_REFEREE_INTRO_RULES,
    `Reveal candidates: ${PLAY_REFEREE_REVEAL_RULE}`,
    `World-motion cues: ${PLAY_REFEREE_CUE_RULE}`,
    `Hard-due events: ${PLAY_REFEREE_HARD_DUE_RULE}`,
    'The newest user message carries this turn\'s state, cues, events and requirements. Earlier user/assistant messages are the committed selected-branch history.',
    ...PLAY_REFEREE_OUTPUT_PROTOCOL,
  ].join('\n');
}

export function hasPlayRefereeFrozenProtocol(frozenSystemPrompt: string): boolean {
  return frozenSystemPrompt.includes(PLAY_REFEREE_PROTOCOL_MARKER);
}
