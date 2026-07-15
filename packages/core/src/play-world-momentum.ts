import type {
  PlayActionKind,
  PlayAgenda,
  PlayAgendaStatus,
  PlayEventPolicy,
  PlayEventVisibility,
  PlayPressure,
  PlayPressureKind,
  PlayPressureStatus,
  PlayRelativeTimeAdvance,
  PlayTimeAdvanceUnit,
  PlayWorldMomentum,
} from './play-types.js';

export const PLAY_WORLD_MOMENTUM_STATE_KEY = 'worldMomentum' as const;

const MAX_MOMENTUM_RECORDS = 24;
const MAX_MOMENTUM_TEXT_LENGTH = 500;
const MAX_TIME_ADVANCE_MINUTES = 525_600;

const PLAY_PRESSURE_KINDS: readonly PlayPressureKind[] = [
  'deadline',
  'pursuit',
  'factionProject',
  'environment',
  'rumor',
  'relationship',
];
const PLAY_PRESSURE_STATUSES: readonly PlayPressureStatus[] = [
  'latent',
  'active',
  'resolved',
];
const PLAY_AGENDA_STATUSES: readonly PlayAgendaStatus[] = [
  'active',
  'blocked',
  'completed',
  'abandoned',
];
const PLAY_EVENT_VISIBILITIES: readonly PlayEventVisibility[] = [
  'playerVisible',
  'rumor',
  'playerUnknown',
];
const PLAY_TIME_ADVANCE_UNITS: readonly PlayTimeAdvanceUnit[] = [
  'minute',
  'hour',
  'day',
];

export interface PlayPressureChange {
  pressureId: string;
  reason: string;
  status?: PlayPressureStatus;
  level?: number;
  nextConsequence?: string | null;
}

export interface PlayAgendaChange {
  agendaId: string;
  reason: string;
  status?: PlayAgendaStatus;
  nextMove?: string | null;
  blockers?: string[];
}

export interface PlayEligibleWorldEventCandidate {
  id: string;
  source: 'pressure' | 'agenda';
  pressureId?: string;
  agendaId?: string;
  label: string;
  consequence: string;
  reason: string;
  visibility: PlayEventVisibility;
  priority: number;
}

export interface EvaluatePlayEligibleWorldEventsInput {
  momentum: PlayWorldMomentum;
  eventPolicy: PlayEventPolicy;
  actionKind: PlayActionKind;
  timeAdvance?: PlayRelativeTimeAdvance;
  sceneEntityIds?: readonly string[];
}

export interface PlayEligibleWorldEventEvaluation {
  effectiveBudget: number;
  candidates: PlayEligibleWorldEventCandidate[];
}

export interface ApplyPlayWorldMomentumChangesInput {
  momentum: PlayWorldMomentum;
  pressureChanges: readonly PlayPressureChange[];
  agendaChanges: readonly PlayAgendaChange[];
  refereeTurnId: string;
  pressureEventIds?: ReadonlyMap<string, readonly string[]>;
}

export const createEmptyPlayWorldMomentum = (): PlayWorldMomentum => ({
  pressures: [],
  agendas: [],
});

export function readPlayWorldMomentum(
  playLocalState: Readonly<Record<string, unknown>>,
): PlayWorldMomentum {
  const value = playLocalState[PLAY_WORLD_MOMENTUM_STATE_KEY];
  return value === undefined
    ? createEmptyPlayWorldMomentum()
    : normalizePlayWorldMomentum(value);
}

export function normalizePlayWorldMomentum(value: unknown): PlayWorldMomentum {
  if (!isRecord(value)) {
    throw new Error('Play world momentum must be an object.');
  }
  assertOnlyKnownFields(value, ['pressures', 'agendas'], 'Play world momentum');
  if (!Array.isArray(value.pressures) || !Array.isArray(value.agendas)) {
    throw new Error('Play world momentum requires pressures and agendas arrays.');
  }
  if (
    value.pressures.length > MAX_MOMENTUM_RECORDS ||
    value.agendas.length > MAX_MOMENTUM_RECORDS
  ) {
    throw new Error(`Play world momentum supports at most ${MAX_MOMENTUM_RECORDS} records per kind.`);
  }

  const pressures = value.pressures.map(normalizePlayPressure);
  const agendas = value.agendas.map(normalizePlayAgenda);
  assertUniqueIds(pressures, 'pressure');
  assertUniqueIds(agendas, 'agenda');
  return { pressures, agendas };
}

export function normalizePlayRelativeTimeAdvance(
  value: unknown,
): PlayRelativeTimeAdvance {
  if (!isRecord(value)) {
    throw new Error('Play time advance must be an object.');
  }
  assertOnlyKnownFields(value, ['amount', 'unit'], 'Play time advance');
  const amount = value.amount;
  if (!Number.isSafeInteger(amount) || (amount as number) <= 0) {
    throw new Error('Play time advance amount must be a positive safe integer.');
  }
  const unit = normalizeEnum(
    value.unit,
    PLAY_TIME_ADVANCE_UNITS,
    'Play time advance unit',
  );
  const normalized = { amount: amount as number, unit };
  if (playRelativeTimeAdvanceMinutes(normalized) > MAX_TIME_ADVANCE_MINUTES) {
    throw new Error('Play time advance cannot exceed one year.');
  }
  return normalized;
}

export function formatPlayRelativeTimeAdvance(
  value: PlayRelativeTimeAdvance,
): string {
  const normalized = normalizePlayRelativeTimeAdvance(value);
  switch (normalized.unit) {
    case 'minute': return `PT${normalized.amount}M`;
    case 'hour': return `PT${normalized.amount}H`;
    case 'day': return `P${normalized.amount}D`;
  }
}

export function evaluatePlayEligibleWorldEvents(
  input: EvaluatePlayEligibleWorldEventsInput,
): PlayEligibleWorldEventEvaluation {
  const momentum = normalizePlayWorldMomentum(input.momentum);
  const timeIsAdvancing = input.actionKind === 'wait' || input.timeAdvance !== undefined;
  const sceneEntityIds = new Set(
    (input.sceneEntityIds ?? []).map((value) => value.trim()).filter(Boolean),
  );
  const candidates: PlayEligibleWorldEventCandidate[] = [];

  for (const pressure of momentum.pressures) {
    if (
      pressure.status !== 'active' ||
      !pressure.nextConsequence ||
      !isVisibilityAllowed(pressure.visibility, input.eventPolicy)
    ) {
      continue;
    }
    const thresholdReached = pressure.level !== undefined &&
      pressure.threshold !== undefined &&
      pressure.level >= pressure.threshold;
    const eligible = thresholdReached ||
      input.eventPolicy.simulationMode === 'activeWorld' ||
      (
        input.eventPolicy.simulationMode === 'reactiveWorld' &&
        (timeIsAdvancing || pressure.kind === 'deadline' || pressure.kind === 'pursuit')
      ) ||
      (input.eventPolicy.simulationMode === 'conversation' && timeIsAdvancing);
    if (!eligible) {
      continue;
    }
    candidates.push({
      id: `pressure.${pressure.id}`,
      source: 'pressure',
      pressureId: pressure.id,
      label: pressure.label,
      consequence: pressure.nextConsequence,
      reason: thresholdReached
        ? `Pressure ${pressure.id} reached its threshold.`
        : timeIsAdvancing
          ? `Time is advancing while pressure ${pressure.id} remains active.`
          : `World mode makes active pressure ${pressure.id} eligible.`,
      visibility: pressure.visibility,
      priority: (thresholdReached ? 300 : 200) + pressurePriority(pressure.kind),
    });
  }

  for (const agenda of momentum.agendas) {
    if (
      agenda.status !== 'active' ||
      agenda.blockers.length > 0 ||
      !agenda.nextMove ||
      !isVisibilityAllowed(agenda.visibility, input.eventPolicy)
    ) {
      continue;
    }
    const ownerInScene = sceneEntityIds.has(agenda.ownerEntityId);
    const eligible = input.eventPolicy.simulationMode === 'activeWorld' ||
      (
        input.eventPolicy.simulationMode === 'reactiveWorld' &&
        (timeIsAdvancing || ownerInScene)
      ) ||
      (input.eventPolicy.simulationMode === 'conversation' && timeIsAdvancing);
    if (!eligible) {
      continue;
    }
    candidates.push({
      id: `agenda.${agenda.id}`,
      source: 'agenda',
      agendaId: agenda.id,
      label: `${agenda.ownerEntityId}: ${agenda.goal}`,
      consequence: agenda.nextMove,
      reason: timeIsAdvancing
        ? `Time is advancing while agenda ${agenda.id} can act.`
        : ownerInScene
          ? `Agenda owner ${agenda.ownerEntityId} is in the current cast.`
          : `Active-world mode makes agenda ${agenda.id} eligible.`,
      visibility: agenda.visibility,
      priority: 100 + (ownerInScene ? 20 : 0),
    });
  }

  candidates.sort((left, right) =>
    right.priority - left.priority || left.id.localeCompare(right.id));
  const policyBudget = candidates.some((candidate) => candidate.priority >= 300)
    ? Math.max(1, densityBudget(input.eventPolicy))
    : densityBudget(input.eventPolicy);
  const effectiveBudget = Math.min(
    normalizeEventMaximum(input.eventPolicy.maxExternalEventsPerTurn),
    policyBudget,
    candidates.length,
  );

  return {
    effectiveBudget,
    candidates: candidates.slice(0, effectiveBudget),
  };
}

export function normalizePlayPressureChanges(value: unknown): PlayPressureChange[] {
  return normalizeChanges(value, 'pressure').map((change) => {
    assertOnlyKnownFields(
      change,
      ['pressureId', 'reason', 'status', 'level', 'nextConsequence'],
      'Play pressure change',
    );
    const pressureId = assertSafeMomentumId(change.pressureId, 'pressureId');
    const reason = normalizeText(change.reason, 'pressure change reason');
    const status = change.status === undefined
      ? undefined
      : normalizeEnum(change.status, PLAY_PRESSURE_STATUSES, 'pressure status');
    const level = change.level === undefined
      ? undefined
      : normalizeMeter(change.level, 'pressure level');
    const nextConsequence = change.nextConsequence === null
      ? null
      : change.nextConsequence === undefined
        ? undefined
        : normalizeText(change.nextConsequence, 'pressure next consequence');
    if (status === undefined && level === undefined && nextConsequence === undefined) {
      throw new Error(`Play pressure change ${pressureId} has no state change.`);
    }
    return {
      pressureId,
      reason,
      ...(status ? { status } : {}),
      ...(level !== undefined ? { level } : {}),
      ...(nextConsequence !== undefined ? { nextConsequence } : {}),
    };
  });
}

export function normalizePlayAgendaChanges(value: unknown): PlayAgendaChange[] {
  return normalizeChanges(value, 'agenda').map((change) => {
    assertOnlyKnownFields(
      change,
      ['agendaId', 'reason', 'status', 'nextMove', 'blockers'],
      'Play agenda change',
    );
    const agendaId = assertSafeMomentumId(change.agendaId, 'agendaId');
    const reason = normalizeText(change.reason, 'agenda change reason');
    const status = change.status === undefined
      ? undefined
      : normalizeEnum(change.status, PLAY_AGENDA_STATUSES, 'agenda status');
    const nextMove = change.nextMove === null
      ? null
      : change.nextMove === undefined
        ? undefined
        : normalizeText(change.nextMove, 'agenda next move');
    const blockers = change.blockers === undefined
      ? undefined
      : normalizeTextList(change.blockers, 'agenda blockers', 12);
    if (status === undefined && nextMove === undefined && blockers === undefined) {
      throw new Error(`Play agenda change ${agendaId} has no state change.`);
    }
    return {
      agendaId,
      reason,
      ...(status ? { status } : {}),
      ...(nextMove !== undefined ? { nextMove } : {}),
      ...(blockers ? { blockers } : {}),
    };
  });
}

export function applyPlayWorldMomentumChanges(
  input: ApplyPlayWorldMomentumChangesInput,
): PlayWorldMomentum {
  const current = normalizePlayWorldMomentum(input.momentum);
  const refereeTurnId = assertSafeMomentumId(input.refereeTurnId, 'refereeTurnId');
  const pressures = current.pressures.map((pressure) => ({
    ...pressure,
    causeRefs: [...pressure.causeRefs],
  }));
  const agendas = current.agendas.map((agenda) => ({
    ...agenda,
    blockers: [...agenda.blockers],
  }));
  const pressuresById = new Map(pressures.map((pressure) => [pressure.id, pressure]));
  const agendasById = new Map(agendas.map((agenda) => [agenda.id, agenda]));
  const changedPressureIds = new Set<string>();
  const changedAgendaIds = new Set<string>();

  for (const rawChange of input.pressureChanges) {
    const change = normalizePlayPressureChanges([rawChange])[0]!;
    if (changedPressureIds.has(change.pressureId)) {
      throw new Error(`Play pressure changes contain duplicate id: ${change.pressureId}.`);
    }
    changedPressureIds.add(change.pressureId);
    const pressure = pressuresById.get(change.pressureId);
    if (!pressure) {
      throw new Error(`Play pressure change references unknown pressure: ${change.pressureId}.`);
    }
    if (pressure.status === 'resolved') {
      throw new Error(`Resolved Play pressure cannot change: ${pressure.id}.`);
    }
    if (change.level !== undefined && pressure.level === undefined) {
      throw new Error(`Qualitative Play pressure cannot gain a numeric level: ${pressure.id}.`);
    }
    if (change.level !== undefined && pressure.threshold !== undefined && change.level > pressure.threshold) {
      throw new Error(`Play pressure level cannot exceed its threshold: ${pressure.id}.`);
    }
    const previousStatus = pressure.status;
    const previousLevel = pressure.level;
    const previousNextConsequence = pressure.nextConsequence;
    pressure.status = change.status ?? pressure.status;
    if (change.level !== undefined) pressure.level = change.level;
    if (change.nextConsequence === null) delete pressure.nextConsequence;
    else if (change.nextConsequence !== undefined) {
      pressure.nextConsequence = change.nextConsequence;
    }
    if (
      pressure.status === previousStatus &&
      pressure.level === previousLevel &&
      pressure.nextConsequence === previousNextConsequence
    ) {
      throw new Error(`Play pressure change does not advance state: ${pressure.id}.`);
    }
    const causeRefs = input.pressureEventIds?.get(pressure.id) ?? [refereeTurnId];
    pressure.causeRefs = [...new Set([...pressure.causeRefs, ...causeRefs])];
  }

  for (const rawChange of input.agendaChanges) {
    const change = normalizePlayAgendaChanges([rawChange])[0]!;
    if (changedAgendaIds.has(change.agendaId)) {
      throw new Error(`Play agenda changes contain duplicate id: ${change.agendaId}.`);
    }
    changedAgendaIds.add(change.agendaId);
    const agenda = agendasById.get(change.agendaId);
    if (!agenda) {
      throw new Error(`Play agenda change references unknown agenda: ${change.agendaId}.`);
    }
    if (agenda.status === 'completed' || agenda.status === 'abandoned') {
      throw new Error(`Terminal Play agenda cannot change: ${agenda.id}.`);
    }
    const previousStatus = agenda.status;
    const previousNextMove = agenda.nextMove;
    const previousBlockers = [...agenda.blockers];
    agenda.status = change.status ?? agenda.status;
    if (change.nextMove === null) delete agenda.nextMove;
    else if (change.nextMove !== undefined) agenda.nextMove = change.nextMove;
    if (change.blockers !== undefined) agenda.blockers = [...change.blockers];
    if (
      agenda.status === previousStatus &&
      agenda.nextMove === previousNextMove &&
      isDeepEqual(agenda.blockers, previousBlockers)
    ) {
      throw new Error(`Play agenda change does not advance state: ${agenda.id}.`);
    }
    agenda.updatedAtTurnId = refereeTurnId;
  }

  return normalizePlayWorldMomentum({ pressures, agendas });
}

export function assertPlayWorldMomentumTransition(
  previousValue: unknown,
  nextValue: unknown,
): void {
  const previous = normalizePlayWorldMomentum(previousValue);
  const next = normalizePlayWorldMomentum(nextValue);
  const nextPressures = new Map(next.pressures.map((pressure) => [pressure.id, pressure]));
  const nextAgendas = new Map(next.agendas.map((agenda) => [agenda.id, agenda]));
  if (
    previous.pressures.length !== next.pressures.length ||
    previous.agendas.length !== next.agendas.length
  ) {
    throw new Error('Play world momentum records cannot be added or removed after session creation.');
  }
  for (const pressure of previous.pressures) {
    const candidate = nextPressures.get(pressure.id);
    if (!candidate) {
      throw new Error(`Play world momentum removes pressure: ${pressure.id}.`);
    }
    if (pressure.status === 'resolved' && !isDeepEqual(pressure, candidate)) {
      throw new Error(`Resolved Play pressure cannot change: ${pressure.id}.`);
    }
    if (
      (pressure.level === undefined) !== (candidate.level === undefined) ||
      pressure.threshold !== candidate.threshold
    ) {
      throw new Error(`Play pressure numeric contract cannot change: ${pressure.id}.`);
    }
    if (
      pressure.kind !== candidate.kind ||
      pressure.label !== candidate.label ||
      pressure.visibility !== candidate.visibility
    ) {
      throw new Error(`Play pressure immutable identity cannot change: ${pressure.id}.`);
    }
  }
  for (const agenda of previous.agendas) {
    const candidate = nextAgendas.get(agenda.id);
    if (!candidate) {
      throw new Error(`Play world momentum removes agenda: ${agenda.id}.`);
    }
    if (
      (agenda.status === 'completed' || agenda.status === 'abandoned') &&
      !isDeepEqual(agenda, candidate)
    ) {
      throw new Error(`Terminal Play agenda cannot change: ${agenda.id}.`);
    }
    if (
      agenda.ownerEntityId !== candidate.ownerEntityId ||
      agenda.goal !== candidate.goal ||
      agenda.visibility !== candidate.visibility
    ) {
      throw new Error(`Play agenda immutable identity cannot change: ${agenda.id}.`);
    }
  }
}

function normalizePlayPressure(value: unknown): PlayPressure {
  if (!isRecord(value)) {
    throw new Error('Every Play pressure must be an object.');
  }
  assertOnlyKnownFields(value, [
    'id',
    'kind',
    'label',
    'status',
    'level',
    'threshold',
    'causeRefs',
    'nextConsequence',
    'visibility',
  ], 'Play pressure');
  const level = value.level === undefined
    ? undefined
    : normalizeMeter(value.level, 'pressure level');
  const threshold = value.threshold === undefined
    ? undefined
    : normalizePositiveMeter(value.threshold, 'pressure threshold');
  if ((level === undefined) !== (threshold === undefined)) {
    throw new Error('Play pressure level and threshold must appear together.');
  }
  if (level !== undefined && threshold !== undefined && level > threshold) {
    throw new Error('Play pressure level cannot exceed its threshold.');
  }
  const nextConsequence = value.nextConsequence === undefined
    ? undefined
    : normalizeText(value.nextConsequence, 'pressure next consequence');
  return {
    id: assertSafeMomentumId(value.id, 'pressure id'),
    kind: normalizeEnum(value.kind, PLAY_PRESSURE_KINDS, 'pressure kind'),
    label: normalizeText(value.label, 'pressure label'),
    status: normalizeEnum(value.status, PLAY_PRESSURE_STATUSES, 'pressure status'),
    ...(level !== undefined ? { level } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
    causeRefs: normalizeSafeIdList(value.causeRefs, 'pressure causeRefs'),
    ...(nextConsequence ? { nextConsequence } : {}),
    visibility: normalizeEnum(
      value.visibility,
      PLAY_EVENT_VISIBILITIES,
      'pressure visibility',
    ),
  };
}

function normalizePlayAgenda(value: unknown): PlayAgenda {
  if (!isRecord(value)) {
    throw new Error('Every Play agenda must be an object.');
  }
  assertOnlyKnownFields(value, [
    'id',
    'ownerEntityId',
    'goal',
    'nextMove',
    'blockers',
    'status',
    'visibility',
    'updatedAtTurnId',
  ], 'Play agenda');
  const nextMove = value.nextMove === undefined
    ? undefined
    : normalizeText(value.nextMove, 'agenda next move');
  return {
    id: assertSafeMomentumId(value.id, 'agenda id'),
    ownerEntityId: normalizeText(value.ownerEntityId, 'agenda ownerEntityId'),
    goal: normalizeText(value.goal, 'agenda goal'),
    ...(nextMove ? { nextMove } : {}),
    blockers: normalizeTextList(value.blockers, 'agenda blockers', 12),
    status: normalizeEnum(value.status, PLAY_AGENDA_STATUSES, 'agenda status'),
    visibility: normalizeEnum(
      value.visibility,
      PLAY_EVENT_VISIBILITIES,
      'agenda visibility',
    ),
    updatedAtTurnId: assertSafeMomentumId(
      value.updatedAtTurnId,
      'agenda updatedAtTurnId',
    ),
  };
}

function normalizeChanges(
  value: unknown,
  kind: 'pressure' | 'agenda',
): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12) {
    throw new Error(`Play ${kind} changes must be an array of at most 12 items.`);
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error(`Every Play ${kind} change must be an object.`);
    }
    return item;
  });
}

function normalizeTextList(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array of at most ${maximum} strings.`);
  }
  const values = value.map((item) => normalizeText(item, label));
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return values;
}

function normalizeSafeIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 24) {
    throw new Error(`${label} must be an array of at most 24 ids.`);
  }
  const values = value.map((item) => assertSafeMomentumId(item, label));
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return values;
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_MOMENTUM_TEXT_LENGTH) {
    throw new Error(`${label} must contain 1-${MAX_MOMENTUM_TEXT_LENGTH} characters.`);
  }
  return normalized;
}

function normalizeMeter(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function normalizePositiveMeter(value: unknown, label: string): number {
  const meter = normalizeMeter(value, label);
  if (meter === 0) {
    throw new Error(`${label} must be positive.`);
  }
  return meter;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`Invalid ${label}: ${String(value)}.`);
  }
  return value as T;
}

function assertSafeMomentumId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..') ||
    value.length > 160
  ) {
    throw new Error(`Invalid Play ${label}.`);
  }
  return value;
}

function assertUniqueIds(
  values: ReadonlyArray<{ id: string }>,
  label: string,
): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) {
      throw new Error(`Play world momentum contains duplicate ${label} id: ${value.id}.`);
    }
    ids.add(value.id);
  }
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const known = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !known.has(field));
  if (unknown.length) {
    throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}.`);
  }
}

function isVisibilityAllowed(
  visibility: PlayEventVisibility,
  policy: PlayEventPolicy,
): boolean {
  return visibility !== 'playerUnknown' || (policy.allowHidden && policy.allowOffscreen);
}

function densityBudget(policy: PlayEventPolicy): number {
  if (policy.simulationMode === 'conversation') {
    return policy.density === 'quiet' ? 0 : 1;
  }
  if (policy.simulationMode === 'reactiveWorld') {
    return policy.density === 'volatile' ? 2 : 1;
  }
  switch (policy.density) {
    case 'quiet': return 1;
    case 'balanced': return 2;
    case 'volatile': return 3;
  }
}

function normalizeEventMaximum(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function pressurePriority(kind: PlayPressureKind): number {
  switch (kind) {
    case 'deadline': return 60;
    case 'pursuit': return 50;
    case 'factionProject': return 40;
    case 'environment': return 30;
    case 'relationship': return 20;
    case 'rumor': return 10;
  }
}

function playRelativeTimeAdvanceMinutes(value: PlayRelativeTimeAdvance): number {
  switch (value.unit) {
    case 'minute': return value.amount;
    case 'hour': return value.amount * 60;
    case 'day': return value.amount * 1_440;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
