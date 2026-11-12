import type { Context } from 'hono';
import { createRevisionImpactReport, listRevisionImpactReports, readRevisionImpactReport } from '@oh-awesome-novel/tools';

export function createRevisionImpactHandlers(getWorkspaceRoot: () => string) {
  return async (context: Context, operation: 'create' | 'list' | 'read', id?: string): Promise<Response> => {
    try {
      const root = getWorkspaceRoot(); const raw = await context.req.text();
      if (raw.length > 4000) throw new Error('影响分析请求过长。');
      const body = JSON.parse(raw) as Record<string, unknown>;
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !['expectedWorkspaceRoot', ...(operation === 'create' ? ['source'] : [])].includes(key))) throw new Error('影响分析请求无效。');
      if (body.expectedWorkspaceRoot !== root) throw new Error('工作区已切换，请重新分析。');
      const result = operation === 'create' ? await createRevisionImpactReport(root, body.source)
        : operation === 'read' ? await readRevisionImpactReport(root, id!) : { reports: await listRevisionImpactReports(root) };
      if (getWorkspaceRoot() !== root || context.req.raw.signal.aborted) throw new Error('请求已取消或工作区已切换。');
      return context.json(result);
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : '影响分析失败。' }, 409); }
  };
}
