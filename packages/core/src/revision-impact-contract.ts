export type RevisionImpactSource = { kind: 'git'; path: string; ref: string } | { kind: 'acceptedAction'; actionId: string };
export type RevisionImpactKind = 'derived' | 'reference' | 'generationRead' | 'mention';
export const REVISION_IMPACT_LABELS: Record<RevisionImpactKind, string> = { derived: '确定的派生依赖', reference: '已登记对象引用', generationRead: '生成时读取过', mention: '名称或词项命中' };
export interface RevisionImpactComparison {
  path: string; beforeKnown: boolean; beforeHash: string | null; afterHash: string | null; beforeRef?: string;
  change: 'changed' | 'unchanged' | 'unknown'; oldTextAvailable: boolean;
}
export interface RevisionImpactItem {
  id: string; kind: RevisionImpactKind; sourcePath: string; path: string; reason: string; location: string;
  evidence: string; evidenceHash?: string; line?: number; beforeStatus?: string; status?: string;
  generationId?: string; targetKnown?: boolean;
}
export interface RevisionImpactReport {
  schemaVersion: 1; id: string; createdAt: string; source: RevisionImpactSource; comparisons: RevisionImpactComparison[];
  items: RevisionImpactItem[]; counts: Record<RevisionImpactKind, number>; omittedItems: number;
  manifest: Array<{ path: string; hash: string | null }>; snapshotFingerprint: string; evidenceFingerprint: string;
  coverage: { complete: boolean; scannedFiles: number; loadedFiles: number; loadedBytes: number; gaps: string[] };
}
export interface RevisionImpactView { report: RevisionImpactReport; stale: boolean; staleReason?: string }
export interface RevisionImpactRepair { kind: 'open' | 'review' | 'settleChapter' | 'summarizeVolume' | 'summarizeGlobal'; path: string; line?: number }
export interface RevisionImpactRequest { source: RevisionImpactSource; nonce: number }
