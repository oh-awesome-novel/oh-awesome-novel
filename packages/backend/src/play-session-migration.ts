import type { Context } from 'hono';
import { confirmPlaySessionMigration, previewPlaySessionMigration, PlaySessionWriteConflictError } from '@oh-awesome-novel/core';

export function createPlaySessionMigrationHandlers(input: {
  getWorkspaceRoot(): string;
  reserve(root: string, id: string): (() => void) | undefined;
}) {
  return {
    async preview(context: Context, id: string): Promise<Response> {
      try {
        return context.json({ preview: await previewPlaySessionMigration(input.getWorkspaceRoot(), id) ?? null });
      } catch (error) { return failure(context, error); }
    },
    async confirm(context: Context, id: string): Promise<Response> {
      let release: (() => void) | undefined;
      try {
        const body: unknown = await context.req.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) return context.json({ error: 'Invalid migration confirmation.' }, 400);
        const request = body as Record<string, unknown>;
        if (Object.keys(request).some((key) => !['baseRevision', 'sourceFingerprint', 'confirmed'].includes(key)) ||
          request.confirmed !== true || !Number.isSafeInteger(request.baseRevision) || (request.baseRevision as number) < 0 ||
          typeof request.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(request.sourceFingerprint)) {
          return context.json({ error: 'Explicit confirmation and the reviewed migration revision and fingerprint are required.' }, 400);
        }
        const root = input.getWorkspaceRoot();
        release = input.reserve(root, id);
        if (!release) return context.json({ error: 'Play session is being modified.' }, 409);
        const session = await confirmPlaySessionMigration(root, id, {
          baseRevision: request.baseRevision as number, sourceFingerprint: request.sourceFingerprint,
        });
        return context.json({ session });
      } catch (error) { return failure(context, error); }
      finally { release?.(); }
    },
  };
}

function failure(context: Context, error: unknown): Response {
  return context.json({ error: error instanceof Error ? error.message : String(error) },
    error instanceof PlaySessionWriteConflictError ? 409 : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 422);
}
