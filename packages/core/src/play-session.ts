import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';

import type { ContextBudgetLayer, SemanticBoundary } from './agent-context-package.js';

export const PLAY_SESSION_FILES = [
  'session.yaml',
  'transcript.md',
  'play-local-state.yaml',
  'activated-sources.yaml',
  'observations.yaml',
  'adoption-candidates.yaml',
] as const;

export type PlaySessionFile = typeof PLAY_SESSION_FILES[number];

export type PlaySourceTrust = 'canonical' | 'interactionHint' | 'playLocal' | 'modelImprovisation';

export type PlayAdoptionTarget =
  | 'chapterDraft'
  | 'state'
  | 'timeline'
  | 'foreshadow';

export interface PlayActivatedSource {
  sourceId: string;
  path?: string;
  reason: string;
  budgetLayer: ContextBudgetLayer;
  semanticBoundary: SemanticBoundary;
  trust: PlaySourceTrust;
}

export interface PlayTranscriptTurn {
  speaker: string;
  content: string;
  createdAt: string;
}

export interface PlayObservation {
  id: string;
  summary: string;
  evidence: string;
  canonical: false;
}

export interface PlayAdoptionCandidate {
  id: string;
  target: PlayAdoptionTarget;
  summary: string;
  evidence: string;
  payload?: Record<string, unknown>;
  requiresPendingAction: true;
}

export interface PlaySession {
  id: string;
  title: string;
  createdAt: string;
  userPersona?: string;
  sceneStart: string;
  characters: string[];
  transcript: PlayTranscriptTurn[];
  playLocalState: Record<string, unknown>;
  activatedSources: PlayActivatedSource[];
  observations: PlayObservation[];
  adoptionCandidates: PlayAdoptionCandidate[];
}

export interface CreatePlaySessionInput {
  id: string;
  title: string;
  createdAt?: string;
  userPersona?: string;
  sceneStart: string;
  characters: string[];
  activatedSources?: PlayActivatedSource[];
}

export const createPlaySessionDraft = (
  input: CreatePlaySessionInput,
): PlaySession => ({
  id: assertSafePlaySessionId(input.id),
  title: input.title,
  createdAt: input.createdAt ?? new Date().toISOString(),
  userPersona: input.userPersona,
  sceneStart: input.sceneStart,
  characters: [...input.characters],
  transcript: [],
  playLocalState: {},
  activatedSources: input.activatedSources?.map(assertActivatedSource) ?? [],
  observations: [],
  adoptionCandidates: [],
});

export const createPlayAdoptionCandidate = (
  input: Omit<PlayAdoptionCandidate, 'requiresPendingAction'>,
): PlayAdoptionCandidate => ({
  ...input,
  requiresPendingAction: true,
});

export const resolvePlaySessionPath = (
  workspaceRoot: string,
  sessionId: string,
  file: PlaySessionFile,
): string => {
  assertSafePlaySessionId(sessionId);

  if (!PLAY_SESSION_FILES.includes(file)) {
    throw new Error('Unsupported Play session file.');
  }

  const workspace = resolve(workspaceRoot);
  const filePath = resolve(workspace, '.workspace', 'play-sessions', sessionId, file);
  const fileRelativePath = relative(workspace, filePath);

  if (
    fileRelativePath.startsWith('..') ||
    fileRelativePath === '' ||
    fileRelativePath.includes(`..${sep}`)
  ) {
    throw new Error('Play session path must stay inside workspace.');
  }

  return filePath;
};

export const writePlaySessionFiles = async (
  workspaceRoot: string,
  session: PlaySession,
): Promise<string[]> => {
  const files: Array<[PlaySessionFile, string]> = [
    ['session.yaml', stringify(formatSessionMetadata(session))],
    ['transcript.md', formatTranscript(session)],
    ['play-local-state.yaml', stringify(session.playLocalState)],
    ['activated-sources.yaml', stringify({ activatedSources: session.activatedSources })],
    ['observations.yaml', stringify({ observations: session.observations })],
    ['adoption-candidates.yaml', stringify({ adoptionCandidates: session.adoptionCandidates })],
  ];

  return Promise.all(
    files.map(async ([file, content]) => {
      const filePath = resolvePlaySessionPath(workspaceRoot, session.id, file);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf-8');

      return filePath;
    }),
  );
};

export const readPlaySessionFiles = async (
  workspaceRoot: string,
  sessionId: string,
): Promise<PlaySession> => {
  const metadata = await readPlayYaml<{
    id: string;
    title: string;
    createdAt: string;
    userPersona?: string;
    sceneStart: string;
    characters?: string[];
    transcript?: PlayTranscriptTurn[];
  }>(workspaceRoot, sessionId, 'session.yaml');
  const playLocalState = await readPlayYaml<Record<string, unknown>>(
    workspaceRoot,
    sessionId,
    'play-local-state.yaml',
    {},
  );
  const activatedSources = await readPlayYaml<{ activatedSources?: PlayActivatedSource[] }>(
    workspaceRoot,
    sessionId,
    'activated-sources.yaml',
    {},
  );
  const observations = await readPlayYaml<{ observations?: PlayObservation[] }>(
    workspaceRoot,
    sessionId,
    'observations.yaml',
    {},
  );
  const adoptionCandidates = await readPlayYaml<{ adoptionCandidates?: PlayAdoptionCandidate[] }>(
    workspaceRoot,
    sessionId,
    'adoption-candidates.yaml',
    {},
  );

  return {
    id: assertSafePlaySessionId(metadata.id),
    title: metadata.title,
    createdAt: metadata.createdAt,
    userPersona: metadata.userPersona,
    sceneStart: metadata.sceneStart,
    characters: metadata.characters ?? [],
    transcript: metadata.transcript ?? [],
    playLocalState,
    activatedSources: (activatedSources.activatedSources ?? []).map(assertActivatedSource),
    observations: observations.observations ?? [],
    adoptionCandidates: adoptionCandidates.adoptionCandidates ?? [],
  };
};

export const listPlaySessions = async (
  workspaceRoot: string,
): Promise<PlaySession[]> => {
  const sessionsRoot = resolvePlaySessionsRoot(workspaceRoot);

  try {
    const entries = await readdir(sessionsRoot, { withFileTypes: true });
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readPlaySessionFiles(workspaceRoot, entry.name)),
    );

    return sessions.toSorted((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
};

export const formatPlayWorldRefereePrompt = (session: PlaySession): string => [
  '# Play Mode World Referee',
  '',
  'Run a roleplay sandbox turn inside the OAN novel world.',
  'Use one world referee with character voice/state modules; do not spawn a multi-agent runtime.',
  'Play-local state and transcript are not canonical truth.',
  '',
  `Session: ${session.id}`,
  `Scene start: ${session.sceneStart}`,
  `User persona: ${session.userPersona ?? 'unspecified'}`,
  `Characters: ${session.characters.join(', ') || 'none'}`,
  '',
  'Activated sources:',
  ...(
    session.activatedSources.length
      ? session.activatedSources.map((source) =>
          `- ${source.sourceId} [${source.trust}/${source.budgetLayer}/${source.semanticBoundary}]: ${source.reason}`,
        )
      : ['- none']
  ),
  '',
  'After the turn, record Play observations separately. Do not adopt them into canon without PendingAction.',
].join('\n');

export const addPlayTranscriptTurn = (
  session: PlaySession,
  turn: PlayTranscriptTurn,
): PlaySession => ({
  ...session,
  transcript: [...session.transcript, turn],
});

export const addPlayObservation = (
  session: PlaySession,
  observation: PlayObservation,
): PlaySession => ({
  ...session,
  observations: [...session.observations, observation],
});

export const addPlayAdoptionCandidate = (
  session: PlaySession,
  candidate: PlayAdoptionCandidate,
): PlaySession => ({
  ...session,
  adoptionCandidates: [...session.adoptionCandidates, candidate],
});

function formatTranscript(session: PlaySession): string {
  return [
    `# ${session.title}`,
    '',
    `Session: ${session.id}`,
    `Created: ${session.createdAt}`,
    `Scene: ${session.sceneStart}`,
    '',
    ...session.transcript.map((turn) => [
      `## ${turn.speaker}`,
      '',
      turn.content,
      '',
      `_${turn.createdAt}_`,
      '',
    ].join('\n')),
  ].join('\n');
}

function formatSessionMetadata(session: PlaySession): Record<string, unknown> {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    userPersona: session.userPersona,
    sceneStart: session.sceneStart,
    characters: session.characters,
    transcript: session.transcript,
  };
}

async function readPlayYaml<T>(
  workspaceRoot: string,
  sessionId: string,
  file: PlaySessionFile,
  fallback?: T,
): Promise<T> {
  try {
    const filePath = resolvePlaySessionPath(workspaceRoot, sessionId, file);
    const parsed = parse(await readFile(filePath, 'utf-8')) as T | undefined;
    return parsed ?? (fallback as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && fallback !== undefined) {
      return fallback;
    }

    throw error;
  }
}

function resolvePlaySessionsRoot(workspaceRoot: string): string {
  const workspace = resolve(workspaceRoot);
  const root = resolve(workspace, '.workspace', 'play-sessions');
  const rootRelativePath = relative(workspace, root);

  if (
    rootRelativePath.startsWith('..') ||
    rootRelativePath === '' ||
    rootRelativePath.includes(`..${sep}`)
  ) {
    throw new Error('Play sessions root must stay inside workspace.');
  }

  return root;
}

function assertActivatedSource(source: PlayActivatedSource): PlayActivatedSource {
  if (!source.reason.trim()) {
    throw new Error(`Play activated source ${source.sourceId} requires a reason.`);
  }

  return {
    ...source,
    reason: source.reason.trim(),
  };
}

function assertSafePlaySessionId(sessionId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)) {
    throw new Error('Invalid Play session id.');
  }

  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
    throw new Error('Invalid Play session id.');
  }

  return sessionId;
}
