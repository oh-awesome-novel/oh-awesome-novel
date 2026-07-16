import type { PlayLaunchPackage, PlayLaunchSceneValue } from './play-launch.js';
import type {
  PlaySceneKnowledgeEvidence,
  PlaySceneValue,
  PlaySessionPurpose,
  PlayStartMode,
} from './play-rehearsal.js';
import {
  createPlaySceneRehearsalSessionDraft,
  createPlaySessionDraft,
} from './play-session.js';
import type {
  CreatePlaySceneRehearsalSessionInput,
  PlaySession,
} from './play-session.js';
import type { PlayActivatedSource, PlayWorldClock } from './play-types.js';

export const PLAY_LAUNCH_SESSION_METADATA_KEY = 'playLaunch' as const;

export interface PlayLaunchSessionMetadata {
  setupId: string;
  setupSchemaVersion: 1;
  purpose: PlaySessionPurpose;
  startMode: Extract<PlayStartMode, 'guided'>;
}

export interface CreatePlaySessionFromLaunchPackageOptions {
  id: string;
  createdAt?: string;
}

/**
 * Materializes a confirmed, source-backed setup through the existing v4/v5
 * session writers. The immutable setup remains provenance; it is not a second
 * session or world-clock truth.
 */
export function createPlaySessionFromLaunchPackage(
  launchPackage: PlayLaunchPackage,
  options: CreatePlaySessionFromLaunchPackageOptions,
): PlaySession {
  assertLaunchPackageCanStart(launchPackage);
  const worldClock = createLaunchWorldClock(launchPackage);
  const activatedSources = launchPackage.sourceBase.activatedSources.map(
    toActivatedSource,
  );
  const characters = launchPackage.participantRoles.map((participant) =>
    participant.displayName);
  const common = {
    id: options.id,
    title: launchPackage.title,
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    ...(launchPackage.identity.persona
      ? { userPersona: launchPackage.identity.persona }
      : {}),
    sceneStart: launchPackage.entryPoint.opening,
    characters,
    activatedSources,
    eventPolicy: launchPackage.eventPolicy,
  };

  const session = launchPackage.purpose === 'sceneRehearsal'
    ? createPlaySceneRehearsalSessionDraft({
        ...common,
        startMode: 'guided',
        sceneContract: {
          sceneId: launchPackage.entryPoint.id,
          worldClock,
          clockProvenance: createClockProvenance(launchPackage),
          ...copySceneContractValues(launchPackage),
          participantRefs: launchPackage.participantRoles.map((participant) =>
            participant.participantRef),
          orderStrategy: 'directorFixed',
        },
        participants: launchPackage.participantRoles.map((participant) => ({
          participantRef: participant.participantRef,
          ...(participant.canonicalCharacterRef
            ? { canonicalCharacterRef: participant.canonicalCharacterRef }
            : {}),
          displayName: participant.displayName,
          ...(participant.position ? { position: participant.position } : {}),
          ...(participant.currentGoal ? { currentGoal: participant.currentGoal } : {}),
          initialKnowledgeEvidenceRefs: createParticipantEvidenceRefs(participant),
        })),
        initialKnowledgeEvidence: createKnowledgeEvidence(launchPackage),
      } satisfies CreatePlaySceneRehearsalSessionInput)
    : createPlaySessionDraft(common);

  return {
    ...session,
    worldClock,
    branchBaseSnapshot: {
      ...session.branchBaseSnapshot,
      worldClock,
    },
    metadataExtensions: {
      ...session.metadataExtensions,
      [PLAY_LAUNCH_SESSION_METADATA_KEY]: createLaunchMetadata(launchPackage),
    },
  };
}

export function getPlaySessionPurpose(session: PlaySession): PlaySessionPurpose {
  const launchMetadata = getPlayLaunchSessionMetadata(session);
  const purpose = session.schemaVersion === 5
    ? 'sceneRehearsal'
    : launchMetadata?.purpose ?? 'immersiveJourney';
  if (launchMetadata && launchMetadata.purpose !== purpose) {
    throw new Error(
      'Play launch session metadata purpose does not match the parent session schema.',
    );
  }
  return purpose;
}

export function getPlaySessionStartMode(session: PlaySession): PlayStartMode {
  const launchMetadata = getPlayLaunchSessionMetadata(session);
  if (
    launchMetadata &&
    (
      (session.schemaVersion === 5 && launchMetadata.purpose !== 'sceneRehearsal') ||
      (session.schemaVersion === 4 && launchMetadata.purpose !== 'immersiveJourney')
    )
  ) {
    throw new Error(
      'Play launch session metadata purpose does not match the parent session schema.',
    );
  }
  return session.schemaVersion === 5
    ? session.sceneRehearsal.startMode
    : launchMetadata?.startMode ?? 'quick';
}

export function getPlayLaunchSessionMetadata(
  session: Pick<PlaySession, 'metadataExtensions'>,
): PlayLaunchSessionMetadata | undefined {
  const value = session.metadataExtensions[PLAY_LAUNCH_SESSION_METADATA_KEY];
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error('Play launch session metadata must be an object.');
  }
  assertOnlyKnownFields(value, [
    'setupId',
    'setupSchemaVersion',
    'purpose',
    'startMode',
  ]);
  if (value.setupSchemaVersion !== 1) {
    throw new Error('Unsupported Play launch session metadata version.');
  }
  if (value.purpose !== 'immersiveJourney' && value.purpose !== 'sceneRehearsal') {
    throw new Error('Play launch session metadata purpose is invalid.');
  }
  if (value.startMode !== 'guided') {
    throw new Error('Play launch session metadata startMode must be guided.');
  }
  return {
    setupId: assertSafeId(value.setupId, 'setupId'),
    setupSchemaVersion: 1,
    purpose: value.purpose,
    startMode: 'guided',
  };
}

function assertLaunchPackageCanStart(launchPackage: PlayLaunchPackage): void {
  const blocking = launchPackage.diagnostics.filter((item) => item.severity === 'error');
  if (blocking.length) {
    throw new Error('A Play launch package with blocking diagnostics cannot start.');
  }
  for (const source of launchPackage.sourceBase.activatedSources) {
    if (source.status !== 'ready' || !source.contentHash) {
      throw new Error(`Play launch source is not ready: ${source.sourceId}.`);
    }
  }
}

function toActivatedSource(
  source: PlayLaunchPackage['sourceBase']['activatedSources'][number],
): PlayActivatedSource {
  if (source.status !== 'ready' || !source.contentHash) {
    throw new Error(`Play launch source is not ready: ${source.sourceId}.`);
  }
  return {
    sourceId: source.sourceId,
    path: source.path,
    ...(source.objectId ? { objectId: source.objectId } : {}),
    contentHash: source.contentHash,
    role: source.role,
    reason: source.reason,
    budgetLayer: source.budgetLayer,
    semanticBoundary: source.semanticBoundary,
    trust: source.trust,
  };
}

function createLaunchWorldClock(launchPackage: PlayLaunchPackage): PlayWorldClock {
  const anchor = launchPackage.entryPoint.worldTime?.value;
  return {
    turn: 0,
    revision: 0,
    ...(anchor ? { anchor } : {}),
  };
}

function createClockProvenance(
  launchPackage: PlayLaunchPackage,
): CreatePlaySceneRehearsalSessionInput['sceneContract']['clockProvenance'] {
  const worldTime = launchPackage.entryPoint.worldTime;
  if (worldTime?.provenance.kind === 'sourceBacked') {
    return {
      kind: 'newSessionInitial',
      sourceRefs: [...worldTime.provenance.sourceRefs],
    };
  }
  return {
    kind: 'newSessionInitial',
    sourceRefs: [...launchPackage.entryPoint.sourceRefs],
    authorProvidedAt: worldTime?.provenance.kind === 'authorProvided'
      ? worldTime.provenance.providedAt
      : launchPackage.createdAt,
  };
}

function copySceneContractValues(
  launchPackage: PlayLaunchPackage,
): Partial<Pick<CreatePlaySceneRehearsalSessionInput['sceneContract'],
  'location' | 'atmosphere' | 'trigger' | 'objective' | 'risk'>> {
  return {
    ...(launchPackage.entryPoint.location
      ? { location: toSceneValue(launchPackage.entryPoint.location) }
      : {}),
    ...(launchPackage.entryPoint.atmosphere
      ? { atmosphere: toSceneValue(launchPackage.entryPoint.atmosphere) }
      : {}),
    ...(launchPackage.entryPoint.trigger
      ? { trigger: toSceneValue(launchPackage.entryPoint.trigger) }
      : {}),
    ...(launchPackage.entryPoint.objective
      ? { objective: toSceneValue(launchPackage.entryPoint.objective) }
      : {}),
    ...(launchPackage.entryPoint.risk
      ? { risk: toSceneValue(launchPackage.entryPoint.risk) }
      : {}),
  };
}

function toSceneValue(value: PlayLaunchSceneValue): PlaySceneValue {
  return structuredClone(value);
}

function createKnowledgeEvidence(
  launchPackage: PlayLaunchPackage,
): PlaySceneKnowledgeEvidence[] {
  const sourceById = new Map(
    launchPackage.sourceBase.activatedSources.map((source) => [source.sourceId, source]),
  );
  return launchPackage.participantRoles.flatMap((participant) =>
    participant.initialKnowledge.flatMap((knowledge) => {
      if (!knowledge.sourceRefs.length) {
        return [{
          id: knowledge.id,
          participantRef: participant.participantRef,
          visibility: knowledge.visibility,
          fact: knowledge.fact,
          provenance: {
            kind: 'authorProvided' as const,
            providedAt: launchPackage.createdAt,
          },
        }];
      }
      return knowledge.sourceRefs.map((sourceRef, index) => {
        const source = sourceById.get(sourceRef);
        if (!source?.contentHash) {
          throw new Error(`Knowledge evidence source is not ready: ${sourceRef}.`);
        }
        return {
          id: knowledge.sourceRefs.length === 1
            ? knowledge.id
            : `${knowledge.id}-${index + 1}`,
          participantRef: participant.participantRef,
          visibility: knowledge.visibility,
          fact: knowledge.fact,
          provenance: {
            kind: 'sourceBacked' as const,
            sourceId: source.sourceId,
            sourcePath: source.path,
            contentHash: source.contentHash,
            sourceFactRef: knowledge.id,
          },
        };
      });
    }));
}

function createParticipantEvidenceRefs(
  participant: PlayLaunchPackage['participantRoles'][number],
): string[] {
  return participant.initialKnowledge.flatMap((knowledge) =>
    knowledge.sourceRefs.length <= 1
      ? [knowledge.id]
      : knowledge.sourceRefs.map((_, index) => `${knowledge.id}-${index + 1}`));
}

function createLaunchMetadata(
  launchPackage: PlayLaunchPackage,
): PlayLaunchSessionMetadata {
  return {
    setupId: launchPackage.id,
    setupSchemaVersion: 1,
    purpose: launchPackage.purpose,
    startMode: 'guided',
  };
}

function assertSafeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..')
  ) {
    throw new Error(`Play launch session ${label} is invalid.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  const known = new Set(fields);
  const unknown = Object.keys(value).find((field) => !known.has(field));
  if (unknown) {
    throw new Error(`Play launch session metadata contains unknown field: ${unknown}.`);
  }
}
