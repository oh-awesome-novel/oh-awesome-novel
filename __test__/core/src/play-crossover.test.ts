import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { acceptPlayTurnAttemptStep, addPlayTurnAttemptStep, createPlayParticipantKnowledgeEvidence, finalizePlaySceneRehearsalAttempt, grantPlayTurnAttemptKnowledge, startPlaySceneRehearsalAttempt, writePlayTurnAttemptRecovery,
  createCharacterPerceptionPackage, createPlaySessionFromLaunchPackage, getPlayFrozenSystemPrompt, normalizePlayLaunchPackage,
  previewPlayLaunchPackage, readPlayCrossoverContext, readPlayKnowledgeState, readPlaySessionFiles, restorePlaySessionCheckpoint,
  settlePlayWorldRefereeResponse, settlePlayWorldSettlementRetry, writePlayLaunchPackage, writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';
import { crossoverFixture } from './fixtures/crossover';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup(purpose: 'immersiveJourney' | 'sceneRehearsal' = 'immersiveJourney') {
  const root = await mkdtemp(join(tmpdir(), 'oan-crossover-')); roots.push(root);
  const input = await crossoverFixture(root, purpose);
  const pkg = await previewPlayLaunchPackage(root, input);
  return { root, input, pkg, session: createPlaySessionFromLaunchPackage(pkg, { id: 'cross' }) };
}
const response = (changes: unknown[] = [], events: unknown[] = [{ kind: 'informationSpread', origin: 'npc', title: '交换资料', summary: 'b1 向 a1 介绍自己的来历。', visibility: 'playerVisible', cause: { reason: '当面交流' } }]) => `四人开始交流。\n\`\`\`oan-play-settlement\n${JSON.stringify({ events, stateDelta: {}, observations: [], suggestedActions: [], knowledgeChanges: changes })}\n\`\`\``;
const learn = { type: 'learnSource', participantRef: 'a1', sourceId: 'b1', eventRef: 1 };
const turn = (session: PlaySession, changes: unknown[] = [learn], events?: unknown[]) => settlePlayWorldRefereeResponse({ session, userText: '互相介绍', actionKind: 'say', refereeResponse: response(changes, events) });

it('freezes works and rules, emits both nonblocking warnings, and isolates two works with two actors each', async () => {
  const { pkg, session } = await setup('sceneRehearsal');
  expect(pkg.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['crossoverSourceUnassigned', 'crossoverRulesUnresolved']));
  expect(pkg.diagnostics.every(d => d.severity === 'warning')).toBe(true);
  const context = readPlayCrossoverContext(session.metadataExtensions)!;
  for (const participant of context.participants) {
    const perception = createCharacterPerceptionPackage(session.sceneRehearsal!, participant.participantRef, { allowedSceneSourceIds: participant.sourceIds });
    const own = participant.participantRef.startsWith('a') ? 'A' : 'B'; const other = own === 'A' ? 'B' : 'A';
    expect(JSON.stringify(perception)).toContain(`${own}_ONLY_WORLD_RULE`);
    expect(JSON.stringify(perception)).not.toContain(`${other}_ONLY`);
    expect(perception.initialKnowledgeEvidence).toHaveLength(3);
  }
  expect(getPlayFrozenSystemPrompt(session)).toContain('综漫融合契约');
  expect(normalizePlayLaunchPackage(pkg)).toEqual(pkg);
});

it('shares chosen sources only when the author explicitly chooses shared knowledge', async () => {
  const { root, input } = await setup('sceneRehearsal');
  input.crossover!.knowledge = 'shared';
  const session = createPlaySessionFromLaunchPackage(await previewPlayLaunchPackage(root, input), { id: 'shared' });
  const perception = createCharacterPerceptionPackage(session.sceneRehearsal!, 'a1');
  expect(JSON.stringify(perception)).toContain('A_ONLY'); expect(JSON.stringify(perception)).toContain('B_ONLY');
});

it('lets a rehearsal actor learn another work only through an explicit Director grant, with branch-local turn evidence', async () => {
  const { root, pkg, session } = await setup('sceneRehearsal');
  await writePlayLaunchPackage(root, pkg); await writePlaySessionFiles(root, session, { expectedAbsent: true });
  let attempt = await startPlaySceneRehearsalAttempt(root, { sessionId: session.id, attemptId: 'cross-attempt', baseRevision: 0 });
  const append = async (index: number) => {
    const participant = session.sceneRehearsal!.participants[index]!;
    const granted = createPlayParticipantKnowledgeEvidence({ session, sidecar: session.sceneRehearsal!, participantRef: participant.participantRef, attempt, throughQueueIndex: index });
    const perception = createCharacterPerceptionPackage(session.sceneRehearsal!, participant.participantRef, { grantedKnowledgeEvidence: granted });
    const revision = attempt.attemptRevision;
    const stepId = `cross-step-${index}-${revision}`;
    const ref = granted[0]?.id ?? perception.initialKnowledgeEvidence[0]!.id;
    attempt = addPlayTurnAttemptStep(attempt, { expectedAttemptRevision: revision, idempotencyKey: `add-${stepId}`, operation: { mode: 'next' }, perception,
      step: { id: stepId, participantRef: participant.participantRef, queueIndex: index,
        ...(attempt.selectedStepRefs.at(-1) ? { beforeStepRef: attempt.selectedStepRefs.at(-1)! } : {}), perceptionRef: perception.id,
        intentSummary: '观察同伴', narrativeBlocks: [{ id: `block-${stepId}`, kind: 'characterAction', speakerRef: participant.participantRef,
          content: '他认真地听着。', visibility: 'playerVisible', projection: 'transcript', eventRefs: [], sourceRefs: [ref] }],
        settlementContribution: { events: [], stateDelta: {}, pressureChanges: [], agendaChanges: [], scheduledEventChanges: [], knowledgeChanges: [], observations: [], suggestedActions: [] },
        decisionBasisRefs: [ref], createdAt: '2026-11-12T00:00:00.000Z' },
    }).attempt;
    await writePlayTurnAttemptRecovery(root, attempt, { expectedAttemptRevision: revision });
    attempt = acceptPlayTurnAttemptStep(attempt, { expectedAttemptRevision: attempt.attemptRevision, idempotencyKey: `accept-${stepId}`, stepRef: stepId }).attempt;
    await writePlayTurnAttemptRecovery(root, attempt, { expectedAttemptRevision: revision + 1 });
    return perception;
  };
  for (let i = 0; i < 4; i++) await append(i);
  const foreignFact = session.sceneRehearsal!.initialKnowledgeEvidence.find(fact => fact.participantRef === 'a1' && fact.provenance.kind === 'sourceBacked' && fact.provenance.sourceId === 'a1')!;
  const revision = attempt.attemptRevision;
  attempt = grantPlayTurnAttemptKnowledge(attempt, { expectedAttemptRevision: revision, idempotencyKey: 'share-a1-with-b1', interventionId: 'share-a1', participantRef: 'b1',
    effectiveFromStepRef: attempt.selectedStepRefs[2]!, availableFactRefs: [foreignFact.id], grant: { kind: 'existingFact', factRefs: [foreignFact.id] },
  }).attempt;
  await writePlayTurnAttemptRecovery(root, attempt, { expectedAttemptRevision: revision });
  const granted = await append(2); await append(3);
  expect(JSON.stringify(granted.grantedKnowledgeEvidence)).toContain('A_ONLY_CHARACTER_1');
  const finalized = await finalizePlaySceneRehearsalAttempt(root, { sessionId: session.id, attemptId: attempt.id, baseRevision: 0,
    expectedAttemptRevision: attempt.attemptRevision, selectedHeadRef: attempt.selectedStepRefs.at(-1)!, idempotencyKey: 'finish-cross', userText: '继续交谈' });
  expect(readPlayKnowledgeState(finalized.session.playLocalState).records).toEqual([expect.objectContaining({ kind: 'participantGrant', participantRef: 'b1', grantedAtTurnId: 'turn-1-referee' })]);
  expect(readPlayKnowledgeState(restorePlaySessionCheckpoint(finalized.session, 'initial-world').playLocalState).records).toEqual([]);
});

it('records explicit acquisition with its source turn, persists it, and restores/retries without sibling knowledge', async () => {
  const { root, pkg, session } = await setup();
  await writePlayLaunchPackage(root, pkg);
  const settled = turn(session);
  expect(readPlayKnowledgeState(settled.playLocalState).records).toEqual([{ id: 'knowledge-1-1', kind: 'sourceGrant', participantRef: 'a1', sourceId: 'b1', learnedAtTurnId: 'turn-1-referee', learnedByEventId: 'turn-1-event-1', canonical: false }]);
  await writePlaySessionFiles(root, settled, { expectedAbsent: true });
  const reopened = await readPlaySessionFiles(root, settled.id);
  expect(readPlayKnowledgeState(reopened.playLocalState)).toEqual(readPlayKnowledgeState(settled.playLocalState));
  const restored = restorePlaySessionCheckpoint(reopened, 'initial-world');
  expect(readPlayKnowledgeState(restored.playLocalState).records).toEqual([]);
  const retried = settlePlayWorldSettlementRetry({ session: reopened, sourceArtifactId: 'turn-artifact-1', expectedSessionRevision: reopened.revision, refereeResponse: response([]) }).session;
  expect(readPlayKnowledgeState(retried.playLocalState).records).toEqual([]);
  expect(retried.turnArtifacts).toHaveLength(2);
  expect(() => turn(reopened)).toThrow('已在本分支');
});

it('rejects missing/forged participants, sources, events and duplicate grants without mutating a session', async () => {
  const { session } = await setup(); const before = JSON.stringify(session);
  for (const invalid of [{ ...learn, participantRef: 'missing' }, { ...learn, sourceId: 'missing' }, { ...learn, sourceId: 'a1' }, { ...learn, eventRef: 2 }]) {
    expect(() => turn(session, [invalid])).toThrow();
  }
  expect(() => turn(session, [learn, learn])).toThrow();
  expect(() => turn(session, [learn], [])).toThrow();
  expect(JSON.stringify(session)).toBe(before);
});

it('does not add optional fields or change single-work/default prompts, and requires a contract only for multiple works', async () => {
  const { root, input } = await setup();
  const plain = structuredClone(input); delete plain.crossover;
  for (const source of plain.sources) delete source.originWork;
  const oldPackage = await previewPlayLaunchPackage(root, plain);
  const oldSession = createPlaySessionFromLaunchPackage(oldPackage, { id: 'old', createdAt: '2026-11-12T00:00:00.000Z' });
  expect(oldPackage).not.toHaveProperty('crossover');
  expect(oldSession.metadataExtensions).not.toHaveProperty('playCrossover');
  expect(getPlayFrozenSystemPrompt(oldSession)).not.toContain('learnSource');
  expect(normalizePlayLaunchPackage(oldPackage)).toEqual(oldPackage);
  const one = structuredClone(plain);
  one.sources[0]!.originWork = { id: 'work-a', title: '甲作' };
  const oneSession = createPlaySessionFromLaunchPackage(await previewPlayLaunchPackage(root, one), { id: 'one' });
  expect(getPlayFrozenSystemPrompt(oneSession)).toBe(getPlayFrozenSystemPrompt(oldSession));
  expect(() => turn(oldSession)).toThrow('未启用');
  const missing = structuredClone(input); delete missing.crossover;
  await expect(previewPlayLaunchPackage(root, missing)).rejects.toThrow('确认融合契约');
  const mismatch = structuredClone(input); mismatch.crossover!.works[0] = { ...mismatch.crossover!.works[0]!, title: '伪造标题' };
  await expect(previewPlayLaunchPackage(root, mismatch)).rejects.toThrow('不一致');
});

it('removes source-backed scene fields from another work while retaining explicit author scene input', async () => {
  const { root, input } = await setup('sceneRehearsal');
  input.entryPoint.location = { value: 'B_ONLY_LOCATION', provenance: { kind: 'sourceBacked', sourceRefs: ['world-b'] } };
  input.entryPoint.atmosphere = { value: '共同看到的薄雾', provenance: { kind: 'authorProvided', providedAt: '2026-11-12T00:00:00.000Z' } };
  const session = createPlaySessionFromLaunchPackage(await previewPlayLaunchPackage(root, input), { id: 'scene' });
  const allowed = readPlayCrossoverContext(session.metadataExtensions)!.participants.find(p => p.participantRef === 'a1')!.sourceIds;
  const perception = createCharacterPerceptionPackage(session.sceneRehearsal!, 'a1', { allowedSceneSourceIds: allowed });
  expect(perception.scene.location).toBeUndefined(); expect(perception.scene.atmosphere?.value).toBe('共同看到的薄雾');
});
