import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { stringify } from 'yaml';

export const SESSION_ARTIFACT_FILES = [
  'run.yaml',
  'context-package.yaml',
  'outputs.yaml',
  'proposed-patches.yaml',
  'unresolved.md',
] as const;

export type SessionArtifactFile = typeof SESSION_ARTIFACT_FILES[number];

export type SessionRunStatus = 'running' | 'completed' | 'blocked' | 'failed';

export interface SessionInputSource {
  sourceId: string;
  path?: string;
  hash?: string;
}

export interface SessionRunMetadata {
  sessionId: string;
  capability?: string;
  status: SessionRunStatus;
  startedAt: string;
  updatedAt: string;
  inputSources: SessionInputSource[];
  touchedFiles: string[];
}

export interface SessionOutputArtifact {
  id: string;
  type: 'assistantText' | 'contextPackage' | 'chapterDraft' | 'reviewReport' | 'settlementBundle' | 'playTranscript' | 'importPreview';
  title: string;
  path?: string;
  summary: string;
}

export interface SessionProposedPatch {
  id: string;
  title: string;
  touchedFiles: string[];
  status: 'pending' | 'accepted' | 'rejected';
}

export interface AgentSessionArtifact {
  run: SessionRunMetadata;
  outputs: SessionOutputArtifact[];
  proposedPatches: SessionProposedPatch[];
  unresolved: string[];
}

export interface SessionResumeFileSnapshot {
  path: string;
  hash?: string;
  mtimeMs?: number;
  missing: boolean;
}

export interface SessionResumeBoundary {
  sessionId: string;
  capturedAt: string;
  touchedFiles: SessionResumeFileSnapshot[];
}

export interface SessionResumeCheck {
  sessionId: string;
  changedFiles: string[];
  missingFiles: string[];
  prompt: string;
}

export interface AuthorReport {
  status: string;
  candidateOutputs: string[];
  acceptedActions: string[];
  rejectedActions: string[];
  pendingActions: string[];
  unresolvedDecisions: string[];
  nextSuggestedAction: string;
}

export const resolveSessionArtifactPath = (
  workspaceRoot: string,
  sessionId: string,
  file: SessionArtifactFile,
): string => {
  assertSafeSessionId(sessionId);
  assertSessionArtifactFile(file);

  const workspace = resolve(workspaceRoot);
  const artifactPath = resolve(workspace, '.workspace', 'sessions', sessionId, file);
  const artifactRelativePath = relative(workspace, artifactPath);

  if (
    artifactRelativePath.startsWith('..') ||
    artifactRelativePath === '' ||
    artifactRelativePath.includes(`..${sep}`)
  ) {
    throw new Error('Session artifact path must stay inside workspace.');
  }

  return artifactPath;
};

export const writeSessionRunMetadata = async (
  workspaceRoot: string,
  metadata: SessionRunMetadata,
): Promise<string> => writeSessionYaml(workspaceRoot, metadata.sessionId, 'run.yaml', metadata);

export const writeSessionOutputs = async (
  workspaceRoot: string,
  sessionId: string,
  outputs: SessionOutputArtifact[],
): Promise<string> => writeSessionYaml(workspaceRoot, sessionId, 'outputs.yaml', { outputs });

export const writeSessionProposedPatches = async (
  workspaceRoot: string,
  sessionId: string,
  patches: SessionProposedPatch[],
): Promise<string> =>
  writeSessionYaml(workspaceRoot, sessionId, 'proposed-patches.yaml', {
    proposedPatches: patches,
  });

export const writeSessionUnresolved = async (
  workspaceRoot: string,
  sessionId: string,
  unresolved: string[],
): Promise<string> => {
  const filePath = resolveSessionArtifactPath(workspaceRoot, sessionId, 'unresolved.md');
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    ['# Unresolved Decisions', '', ...unresolved.map((item) => `- ${item}`), ''].join('\n'),
    'utf-8',
  );

  return filePath;
};

export const writeAgentSessionArtifact = async (
  workspaceRoot: string,
  artifact: AgentSessionArtifact,
): Promise<string[]> => Promise.all([
  writeSessionRunMetadata(workspaceRoot, artifact.run),
  writeSessionOutputs(workspaceRoot, artifact.run.sessionId, artifact.outputs),
  writeSessionProposedPatches(
    workspaceRoot,
    artifact.run.sessionId,
    artifact.proposedPatches,
  ),
  writeSessionUnresolved(workspaceRoot, artifact.run.sessionId, artifact.unresolved),
]);

export const createSessionResumeBoundary = async (
  workspaceRoot: string,
  sessionId: string,
  touchedFiles: string[],
  capturedAt = new Date().toISOString(),
): Promise<SessionResumeBoundary> => ({
  sessionId,
  capturedAt,
  touchedFiles: await Promise.all(
    touchedFiles.map((file) => snapshotWorkspaceFile(workspaceRoot, file)),
  ),
});

export const checkSessionResumeBoundary = async (
  workspaceRoot: string,
  boundary: SessionResumeBoundary,
): Promise<SessionResumeCheck> => {
  const current = await Promise.all(
    boundary.touchedFiles.map((file) => snapshotWorkspaceFile(workspaceRoot, file.path)),
  );
  const changedFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const snapshot of boundary.touchedFiles) {
    const next = current.find((file) => file.path === snapshot.path);

    if (!next || next.missing) {
      missingFiles.push(snapshot.path);
      continue;
    }

    if (snapshot.hash !== next.hash || snapshot.mtimeMs !== next.mtimeMs) {
      changedFiles.push(snapshot.path);
    }
  }

  return {
    sessionId: boundary.sessionId,
    changedFiles,
    missingFiles,
    prompt: formatResumePrompt(changedFiles, missingFiles),
  };
};

export const formatAuthorReportMarkdown = (report: AuthorReport): string => [
  '## Author Report',
  '',
  `Status: ${report.status}`,
  '',
  '### Candidate Outputs',
  formatList(report.candidateOutputs),
  '',
  '### Actions',
  `- accepted: ${report.acceptedActions.length}`,
  `- rejected: ${report.rejectedActions.length}`,
  `- pending: ${report.pendingActions.length}`,
  '',
  '### Unresolved Decisions',
  formatList(report.unresolvedDecisions),
  '',
  `Next: ${report.nextSuggestedAction}`,
].join('\n');

async function writeSessionYaml(
  workspaceRoot: string,
  sessionId: string,
  file: SessionArtifactFile,
  value: unknown,
): Promise<string> {
  const filePath = resolveSessionArtifactPath(workspaceRoot, sessionId, file);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, stringify(value), 'utf-8');

  return filePath;
}

async function snapshotWorkspaceFile(
  workspaceRoot: string,
  file: string,
): Promise<SessionResumeFileSnapshot> {
  const filePath = resolveWorkspaceFile(workspaceRoot, file);

  try {
    const [fileStat, content] = await Promise.all([
      stat(filePath),
      readFile(filePath),
    ]);

    return {
      path: file,
      hash: createHash('sha256').update(content).digest('hex'),
      mtimeMs: fileStat.mtimeMs,
      missing: false,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        path: file,
        missing: true,
      };
    }

    throw error;
  }
}

function resolveWorkspaceFile(workspaceRoot: string, file: string): string {
  const workspace = resolve(workspaceRoot);
  const absoluteFile = resolve(workspace, file);
  const fileRelativePath = relative(workspace, absoluteFile);

  if (
    fileRelativePath.startsWith('..') ||
    fileRelativePath === '' ||
    fileRelativePath.includes(`..${sep}`)
  ) {
    throw new Error('Session resume file must stay inside workspace.');
  }

  return absoluteFile;
}

function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)) {
    throw new Error('Invalid session id.');
  }

  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
    throw new Error('Invalid session id.');
  }
}

function assertSessionArtifactFile(file: SessionArtifactFile): void {
  if (!SESSION_ARTIFACT_FILES.includes(file)) {
    throw new Error('Unsupported session artifact file.');
  }
}

function formatResumePrompt(changedFiles: string[], missingFiles: string[]): string {
  if (!changedFiles.length && !missingFiles.length) {
    return 'No manual file changes detected. Continue from the recorded artifact.';
  }

  return [
    'Manual file changes were detected before resume.',
    'Choose one path: use manual changes, continue from manual changes, or abandon the stale artifact.',
    changedFiles.length ? `Changed: ${changedFiles.join(', ')}` : '',
    missingFiles.length ? `Missing: ${missingFiles.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function formatList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';
}
