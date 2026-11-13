import { createHash, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { normalizeRosterPortraitSet, parseRosterProfile, readImageAsset } from '@oh-awesome-novel/core';
import type { RosterPortraitSet } from '@oh-awesome-novel/core';
import { createRosterPortraitsChangeProposal, createWorkspaceProjection, readRepositoryBaseline, rosterProfilePath } from '@oh-awesome-novel/tools';
import type { PendingActionStore } from '@oh-awesome-novel/tools';

const MAX_REQUEST_BYTES = 512 * 1024;
const NAME_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * The character portrait form. Reading returns what the roster profile says; saving builds a
 * deterministic candidate that changes only that one YAML file and waits for the author's approval.
 * Images are never read into a candidate: only their paths are text in the profile.
 */
export function createCharacterPortraitHandlers(input: {
  getWorkspaceRoot(): string;
  getStore(root: string): Promise<PendingActionStore>;
}) {
  function fail(context: Context, status: 400 | 404 | 409, code: string, message: string): Response {
    return context.json({ error: { code, message } }, status);
  }
  async function readProfile(root: string, characterId: string) {
    const path = rosterProfilePath(characterId);
    const projection = await createWorkspaceProjection({ workspaceRoot: root, rules: [{ kind: 'exact', path }] });
    const baseline = projection.baselineFiles.find(file => file.path === path);
    return { path, projection, baseline };
  }
  /** Portrait ids whose image is not a readable file right now. A reminder, never a refusal. */
  async function missingImages(root: string, set: RosterPortraitSet | null): Promise<Array<{ id: string; image: string; reason: string }>> {
    const missing: Array<{ id: string; image: string; reason: string }> = [];
    for (const item of set?.items ?? []) {
      if (!item.image) continue;
      try { await readImageAsset(root, item.image); }
      catch (error) { missing.push({ id: item.id, image: item.image, reason: error instanceof Error ? error.message : '图片无法读取。' }); }
    }
    return missing;
  }

  return {
    async read(context: Context, characterId: string): Promise<Response> {
      try {
        const root = input.getWorkspaceRoot();
        const { path, baseline } = await readProfile(root, characterId);
        if (!baseline) return context.json({ characterId, path, profile: null });
        const character = parseRosterProfile(baseline.content);
        if (character.id !== characterId) return fail(context, 409, 'roster_identity_mismatch', '名册里的角色 id 与目录名不一致。');
        const portraits = character.portraits ?? null;
        return context.json({
          characterId,
          path,
          profile: {
            name: character.name,
            sourceHash: sha256(baseline.content),
            portraits,
            nameColor: character.looks.nameColor ?? null,
            // The single legacy image; the form suggests moving it into the portrait set.
            legacyRefImagePath: character.looks.refImagePath ?? null,
            missingImages: await missingImages(root, portraits),
          },
        });
      } catch (error) {
        return fail(context, 400, 'invalid_portrait_request', error instanceof Error ? error.message : String(error));
      }
    },

    async propose(context: Context, characterId: string): Promise<Response> {
      try {
        const root = input.getWorkspaceRoot();
        if (Number(context.req.header('content-length') ?? 0) > MAX_REQUEST_BYTES) return fail(context, 400, 'invalid_portrait_request', '请求过大。');
        const raw = await context.req.text();
        if (raw.length > MAX_REQUEST_BYTES) return fail(context, 400, 'invalid_portrait_request', '请求过大。');
        const body = JSON.parse(raw) as Record<string, unknown>;
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some(key => !['expectedWorkspaceRoot', 'sourceHash', 'portraits', 'nameColor'].includes(key))) {
          return fail(context, 400, 'invalid_portrait_request', '请求格式无效。');
        }
        if (body.expectedWorkspaceRoot !== root) return fail(context, 409, 'workspace_changed', '当前工作区已切换，请重新打开立绘表单。');
        if (body.nameColor !== null && (typeof body.nameColor !== 'string' || !NAME_COLOR.test(body.nameColor))) {
          return fail(context, 400, 'invalid_portrait_request', '名字牌颜色必须是 #RRGGBB。');
        }
        const portraits = body.portraits === null ? null : normalizeRosterPortraitSet(body.portraits);
        const { baseline, projection } = await readProfile(root, characterId);
        if (!baseline) return fail(context, 404, 'roster_profile_missing', '这个角色还没有 roster-profile.yaml。请先用设定工坊生成角色，或自己建立名册文件。');
        if (body.sourceHash !== sha256(baseline.content)) return fail(context, 409, 'stale_roster_profile', '名册文件已被修改，请重新载入后再保存。');
        const id = `pa_${randomUUID()}`;
        const proposal = createRosterPortraitsChangeProposal({
          characterId,
          edit: { portraits, nameColor: body.nameColor },
          repository: await readRepositoryBaseline(root),
          baselineFiles: [baseline],
          sessionId: id,
        });
        if (!proposal) return fail(context, 400, 'no_portrait_change', '立绘没有改动。');
        await projection.assertFresh();
        if (root !== input.getWorkspaceRoot()) return fail(context, 409, 'workspace_changed', '当前工作区已切换，请重新打开立绘表单。');
        const store = await input.getStore(root);
        const pendingAction = await store.proposeCandidate({
          id,
          candidate: proposal.candidate,
          title: `更新角色立绘：${characterId}`,
          description: '只修改名册里的立绘描述、图片路径与名字牌颜色；图片文件本身不在这次改动里。',
        });
        return context.json({ pendingActionId: pendingAction.id, targetPath: proposal.targetPath, missingImages: await missingImages(root, portraits) });
      } catch (error) {
        return fail(context, 400, 'invalid_portrait_request', error instanceof Error ? error.message : String(error));
      }
    },
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
