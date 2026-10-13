export interface PlaySessionMigrationPreview {
  sessionId: string;
  baseRevision: number;
  sourceFingerprint: string;
  fromSchemaVersion: 1 | 2 | 3;
  toSchemaVersion: 4;
  unknownMetadataKeys: string[];
  legacyTranscriptCount: number;
  projectedTurnCount: number;
  generatedTurnIds: string[];
  backupRelativePath: string;
}
export interface PlaySessionMigrationConfirmation {
  confirmed: true;
  baseRevision: number;
  sourceFingerprint: string;
}

export function assertPlayMigrationConfirmation(value: PlaySessionMigrationConfirmation): void {
  if (value.confirmed !== true || !integer(value.baseRevision) || !/^[a-f0-9]{64}$/u.test(value.sourceFingerprint)) {
    throw new Error('Invalid Play migration confirmation.');
  }
}

export function parsePlayMigrationPreview(value: unknown, id: string): { preview: PlaySessionMigrationPreview | null } {
  const envelope = record(value);
  if (!envelope || Object.keys(envelope).length !== 1 || !Object.hasOwn(envelope, 'preview')) throw new Error('Invalid Play migration preview response.');
  if (envelope.preview === null) return { preview: null };
  const p = record(envelope.preview);
  const fields = ['sessionId', 'baseRevision', 'sourceFingerprint', 'fromSchemaVersion', 'toSchemaVersion', 'unknownMetadataKeys', 'legacyTranscriptCount', 'projectedTurnCount', 'generatedTurnIds', 'backupRelativePath'];
  if (!p || Object.keys(p).length !== fields.length || Object.keys(p).some((key) => !fields.includes(key)) ||
    p.sessionId !== id || !integer(p.baseRevision) || typeof p.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(p.sourceFingerprint) ||
    ![1, 2, 3].includes(p.fromSchemaVersion as number) || p.toSchemaVersion !== 4 ||
    !strings(p.unknownMetadataKeys) || !strings(p.generatedTurnIds) || !integer(p.legacyTranscriptCount) || !integer(p.projectedTurnCount) ||
    p.generatedTurnIds.length !== p.projectedTurnCount || new Set(p.generatedTurnIds).size !== p.generatedTurnIds.length ||
    p.generatedTurnIds.some((item) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(item) || item.includes('..')) ||
    p.backupRelativePath !== `.migrations/v${p.fromSchemaVersion}-to-v4/original`) {
    throw new Error('Invalid Play migration preview response.');
  }
  return { preview: p as unknown as PlaySessionMigrationPreview };
}
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
