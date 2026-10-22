import { createHash } from 'node:crypto';
import { createWorkspaceProjection } from '@oh-awesome-novel/tools';
import { createContextEvidence } from '@oh-awesome-novel/agent';
import type { RuntimeContextItem } from '@oh-awesome-novel/runtime';
export interface CanonicalWritingContext { items: RuntimeContextItem[]; assertFresh(): Promise<void> }
export async function loadCanonicalWritingContext(workspaceRoot: string, value: unknown): Promise<CanonicalWritingContext> {
  const paths = value ?? [];
  if (!Array.isArray(paths) || paths.length > 16 || new Set(paths).size !== paths.length
    || !paths.every(path => typeof path === 'string' && /^(?:characters\/[a-zA-Z0-9_-]+\/(?:profile\.md|roster-profile\.yaml)|world\/(?:rules\.md|places\/[a-zA-Z0-9_-]+\.md))$/.test(path))) {
    throw new Error('canonicalWritingSourcePaths must contain at most 16 unique canonical character or world paths.');
  }
  if (!paths.length) return { items: [], async assertFresh() {} };
  const projection = await createWorkspaceProjection({ workspaceRoot, rules: paths.map(path => ({ kind: 'exact', path })), maxFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024 });
  if (projection.baselineFiles.length !== paths.length) throw new Error('A selected canonical writing source no longer exists.');
  return {
    items: projection.baselineFiles.map(file => ({ kind: 'selected', title: `作者选定设定：${file.path}`, content: file.content,
      provenance: [createContextEvidence({ sourceId: 'canonicalWritingSource', kind: 'selected', path: file.path, sourceHash: createHash('sha256').update(file.content).digest('hex'), originalChars: file.content.length, budgetLayer: 'L1', semanticBoundary: 'compressible' })] })),
    assertFresh: () => projection.assertFresh(),
  };
}
