import {
  previewPlayLaunchPackage,
  readPlayLaunchPackage,
  toPlayLaunchCanonBeatsInput,
} from './play-launch.js';
import type {
  PlayLaunchPackage,
  PlayLaunchPackagePreviewInput,
  PlayLaunchSourceRole,
} from './play-launch.js';
import {
  getPlayLaunchSessionMetadata,
  getPlaySessionPurpose,
} from './play-launch-session.js';
import { readPlaySessionFiles } from './play-session.js';
import type { PlaySession } from './play-session.js';
import type {
  PlayEventPolicy,
  PlayWorldMomentum,
} from './play-types.js';
import { readPlayWorldMomentum } from './play-world-momentum.js';

export type PlayLaunchReuseSourceStatus =
  | 'unchanged'
  | 'changed'
  | 'missing'
  | 'invalid';

/** One frozen launch source compared against the workspace bytes of right now. */
export interface PlayLaunchReuseSourceCheck {
  sourceId: string;
  path: string;
  role: PlayLaunchSourceRole;
  status: PlayLaunchReuseSourceStatus;
  frozenContentHash?: string;
  currentContentHash?: string;
  message?: string;
}

export interface PlayLaunchReuseQuickJourneyForm {
  title: string;
  sceneStart: string;
  userPersona?: string;
  characters: string[];
  eventPolicy: PlayEventPolicy;
  /** Only the momentum seeds the author typed into the original quick form. */
  worldMomentum?: PlayWorldMomentum;
}

export interface PlayLaunchReuseQuickRehearsalForm {
  title: string;
  opening: string;
  location: string;
  atmosphere: string;
  objective: string;
  risk: string;
  eventPolicy: PlayEventPolicy;
  participants: Array<{
    participantRef: string;
    displayName: string;
    position: string;
    currentGoal: string;
    initialKnowledge: string;
  }>;
}

interface PlayLaunchReuseSeedBase {
  sourceSessionId: string;
  sourceSessionTitle: string;
}

/**
 * The opening of an existing session, ready to prefill the launch flow. It holds
 * only what the author chose before turn one: no transcript, events, Play-local
 * state, knowledge records or branch ids of the source session.
 */
export type PlayLaunchReuseSeed =
  | (PlayLaunchReuseSeedBase & {
      kind: 'guided';
      purpose: PlayLaunchPackage['purpose'];
      launch: PlayLaunchPackagePreviewInput;
      sources: PlayLaunchReuseSourceCheck[];
    })
  | (PlayLaunchReuseSeedBase & {
      kind: 'quickJourney';
      purpose: 'immersiveJourney';
      form: PlayLaunchReuseQuickJourneyForm;
    })
  | (PlayLaunchReuseSeedBase & {
      kind: 'quickRehearsal';
      purpose: 'sceneRehearsal';
      form: PlayLaunchReuseQuickRehearsalForm;
    });

/**
 * Reads an existing session's opening without mutating it and re-checks every
 * frozen source against the current workspace files, so drift is reported
 * before a new session is created.
 */
export async function readPlayLaunchReuseSeed(
  workspaceRoot: string,
  sessionId: string,
): Promise<PlayLaunchReuseSeed> {
  const session = await readPlaySessionFiles(workspaceRoot, sessionId);
  const base: PlayLaunchReuseSeedBase = {
    sourceSessionId: session.id,
    sourceSessionTitle: session.title,
  };
  const launchMetadata = getPlayLaunchSessionMetadata(session);
  if (launchMetadata) {
    const launchPackage = await readPlayLaunchPackage(
      workspaceRoot,
      launchMetadata.setupId,
    );
    return {
      ...base,
      kind: 'guided',
      purpose: launchPackage.purpose,
      ...(await createGuidedSeed(workspaceRoot, launchPackage)),
    };
  }
  if (getPlaySessionPurpose(session) === 'sceneRehearsal') {
    return {
      ...base,
      kind: 'quickRehearsal',
      purpose: 'sceneRehearsal',
      form: createQuickRehearsalForm(session),
    };
  }
  return {
    ...base,
    kind: 'quickJourney',
    purpose: 'immersiveJourney',
    form: createQuickJourneyForm(session),
  };
}

async function createGuidedSeed(
  workspaceRoot: string,
  launchPackage: PlayLaunchPackage,
): Promise<{
  launch: PlayLaunchPackagePreviewInput;
  sources: PlayLaunchReuseSourceCheck[];
}> {
  const launch = toPlayLaunchPackagePreviewInput(launchPackage);
  const current = await previewPlayLaunchPackage(workspaceRoot, launch);
  const sources = launchPackage.sourceBase.activatedSources.map(
    (frozen, index): PlayLaunchReuseSourceCheck => {
      const now = current.sourceBase.activatedSources[index]!;
      const diagnostic = current.diagnostics.find((item) =>
        item.sourceId === frozen.sourceId && item.severity === 'error');
      const status: PlayLaunchReuseSourceStatus = now.status === 'missing'
        ? 'missing'
        : now.status !== 'ready'
          ? 'invalid'
          : now.contentHash === frozen.contentHash
            ? 'unchanged'
            : 'changed';
      return {
        sourceId: frozen.sourceId,
        path: frozen.path,
        role: frozen.role,
        status,
        ...(frozen.contentHash ? { frozenContentHash: frozen.contentHash } : {}),
        ...(now.contentHash ? { currentContentHash: now.contentHash } : {}),
        ...(status === 'changed'
          ? { message: `Source changed since this opening was frozen: ${frozen.path}` }
          : diagnostic
            ? { message: diagnostic.message }
            : {}),
      };
    },
  );
  return { launch, sources };
}

/** The author's launch choices, stripped of setup identity and frozen evidence. */
export function toPlayLaunchPackagePreviewInput(
  launchPackage: PlayLaunchPackage,
): PlayLaunchPackagePreviewInput {
  return structuredClone({
    title: launchPackage.title,
    purpose: launchPackage.purpose,
    startMode: 'guided' as const,
    simulationMode: launchPackage.eventPolicy.simulationMode,
    density: launchPackage.eventPolicy.density,
    sources: launchPackage.sourceBase.activatedSources.map((source) => ({
      sourceId: source.sourceId,
      ...(source.originWork ? { originWork: source.originWork } : {}),
      path: source.path,
      role: source.role,
      reason: source.reason,
    })),
    entryPoint: launchPackage.entryPoint,
    identity: launchPackage.identity,
    participantRoles: launchPackage.participantRoles,
    ...(launchPackage.crossover ? { crossover: structuredClone(launchPackage.crossover) } : {}),
    ...(launchPackage.canonBeats
      ? { canonBeats: toPlayLaunchCanonBeatsInput(launchPackage.canonBeats) }
      : {}),
  });
}

function createQuickJourneyForm(session: PlaySession): PlayLaunchReuseQuickJourneyForm {
  // The base snapshot of a first-phase session is exactly the quick form's seed
  // state. A continued phase starts from later Play-local state, which must not leak.
  const initialMomentum = session.branchSnapshotRequiredFromRevision === 0 &&
      session.metadataExtensions.playCompactionStartRevision === undefined
    ? readPlayWorldMomentum(session.branchBaseSnapshot.playLocalState)
    : undefined;
  return {
    title: session.title,
    sceneStart: session.sceneStart,
    ...(session.userPersona ? { userPersona: session.userPersona } : {}),
    characters: [...session.characters],
    eventPolicy: { ...session.eventPolicy },
    ...(initialMomentum &&
      (initialMomentum.pressures.length || initialMomentum.agendas.length)
      ? { worldMomentum: initialMomentum }
      : {}),
  };
}

function createQuickRehearsalForm(
  session: PlaySession,
): PlayLaunchReuseQuickRehearsalForm {
  const sidecar = session.sceneRehearsal;
  if (!sidecar) {
    throw new Error('Scene rehearsal session requires its sceneRehearsal metadata.');
  }
  const contract = sidecar.sceneContract;
  const factsByRef = new Map(
    sidecar.initialKnowledgeEvidence.map((evidence) => [evidence.id, evidence.fact]),
  );
  return {
    title: session.title,
    opening: session.sceneStart,
    location: contract.location?.value ?? '',
    atmosphere: contract.atmosphere?.value ?? '',
    objective: contract.objective?.value ?? '',
    risk: contract.risk?.value ?? '',
    eventPolicy: { ...session.eventPolicy },
    // The sidecar keeps participants in the fixed Scene Contract order.
    participants: sidecar.participants.map((participant) => ({
      participantRef: participant.participantRef,
      displayName: participant.displayName,
      position: participant.position ?? '',
      currentGoal: participant.currentGoal ?? '',
      initialKnowledge: participant.initialKnowledgeEvidenceRefs
        .map((ref) => factsByRef.get(ref))
        .filter((fact) => fact !== undefined)
        .join('\n'),
    })),
  };
}
