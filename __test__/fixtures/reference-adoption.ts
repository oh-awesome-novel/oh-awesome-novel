import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startNovelHttpBackend } from "@oh-awesome-novel/backend";
import { createOanClient } from "@oh-awesome-novel/client";
import {
  normalizeReferenceStoryMaterialCoverageModelOutput,
  normalizeReferenceStoryMaterialChapterModelOutput,
  normalizeReferenceStoryMaterialAggregateModelOutput,
  normalizeReferenceStoryMaterialProjectionModelOutput,
} from "@oh-awesome-novel/core";
import type {
  ReferenceQuickPreviewSelection,
  ReferenceStoryMaterialKind,
  ReferenceDeconstructionWorkUnit,
  ReferenceChapterWorkUnitWindow,
  ReferenceStoryMaterialFinding,
} from "@oh-awesome-novel/core";

export async function adoptionJourneyFixture(
  options: Partial<Parameters<typeof startNovelHttpBackend>[0]> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "oan-adoption-journey-"));
  await mkdir(join(root, ".oan"));
  await writeFile(
    join(root, ".oan/config.yaml"),
    "version: 1\nnovelName: Journey\ngit:\n  autoCommitOnAccept: false\nwritingProfile:\n  activeProfileId: fanfictionWriting\n",
  );
  const git = promisify(execFile);
  await git("git", ["init", "-b", "main", root]);
  await git("git", [
    "-C",
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-m",
    "baseline",
  ]);
  const backend = await startNovelHttpBackend({
    workspaceRoot: root,
    globalConfigDir: join(root, ".global"),
    providerConfig: { id: "controlled", kind: "custom", model: "controlled" },
    runReferenceMaterialCoverage: async (input) => completedMaterialCoverage(input),
    runReferenceMaterialChapter: async (input) => ({
      status: "completed",
      finishReason: "stop",
      output: materialChapterOutput(input.runId, input),
    }),
    runReferenceMaterialAggregate: async (input) => ({
      status: "completed",
      finishReason: "stop",
      output: materialAggregateOutput(input.runId, input),
    }),
    runReferenceMaterialProjection: async (input) => ({
      status: "completed",
      finishReason: "stop",
      output: materialProjectionOutput(input.runId, input),
    }),
    ...options,
  });
  const client = createOanClient({ backendBaseUrl: backend.url });
  async function publish(title: string) {
    const { reference } = await client.importReference({
      title,
      sourceText: "第一章 开端\n雨夜里，守门人改变了原定路线。他留下一个尚未解释的选择，然后离开。",
      rights: "owned",
    });
    let { run } = await client.createReferenceDeconstructionRun(reference.id, {
      mode: "quickPreview",
      baseRunRevision: 0,
      idempotencyKey: "create-" + reference.id,
    });
    for (let i = 0; i < 20 && run.status !== "reviewReady"; i++) {
      const input = {
        baseRunRevision: run.runRevision,
        idempotencyKey: `step-${i}-${reference.id}`,
      };
      ({ run } =
        run.status === "awaitingFullApproval"
          ? await client.approveFullReferenceDeconstructionRun(reference.id, run.id, input)
          : await client.advanceReferenceDeconstructionRun(reference.id, run.id, input));
      if (run.status === "failed") throw new Error(JSON.stringify(run.failure));
    }
    const result = await client.publishReferenceDeconstructionRun(reference.id, run.id, {
      baseRunRevision: run.runRevision,
      idempotencyKey: "publish-" + reference.id,
    });
    await client.acceptPendingAction(result.pendingAction.id);
    return reference.id;
  }
  return { root, backend, client, publish };
}

function completedMaterialCoverage(input: {
  runId: string;
  selection: ReferenceQuickPreviewSelection;
  materialKinds: readonly ReferenceStoryMaterialKind[];
}) {
  const firstPointerId = input.selection.windows[0]!.pointerId;
  const output = normalizeReferenceStoryMaterialCoverageModelOutput(
    {
      items: input.materialKinds.map((materialKind) => ({
        materialKind,
        coverage: "substantial" as const,
        summary: `The bounded preview covers concrete ${materialKind} material.`,
        confidence: "medium" as const,
        evidenceRefs: [firstPointerId],
        uncertainty: null,
      })),
      uncertainties: [],
    },
    {
      runId: input.runId,
      selection: input.selection,
      materialKinds: input.materialKinds,
    },
  );
  return { status: "completed" as const, finishReason: "stop" as const, output };
}

function materialChapterOutput(
  runId: string,
  input: {
    unit: ReferenceDeconstructionWorkUnit;
    materialKinds: readonly ReferenceStoryMaterialKind[];
    sourceWindows: readonly ReferenceChapterWorkUnitWindow[];
  },
) {
  const sourceWindow = input.sourceWindows[0]!;
  return normalizeReferenceStoryMaterialChapterModelOutput(
    {
      summary: "The bounded source window contains concrete story material.",
      summaryEvidenceRefs: [sourceWindow.pointerId],
      findings: input.materialKinds.map((materialKind) => ({
        materialKind,
        title: `${materialKind} bounded fact`,
        content: `A concrete ${materialKind} fact remains attached to its source evidence.`,
        details: [`The ${materialKind} fixture remains specific and auditable.`],
        assertionType: "fact" as const,
        confidence: "medium" as const,
        evidenceRefs: [sourceWindow.pointerId],
        uncertainty: null,
      })),
      uncertainties: [],
    },
    {
      runId,
      unit: input.unit,
      materialKinds: input.materialKinds,
      allowedPointers: Object.fromEntries(
        input.sourceWindows.map((window) => [window.pointerId, window.pointer]),
      ),
    },
  );
}

function materialAggregateOutput(runId: string, input: MaterialReductionFixtureInput) {
  return normalizeReferenceStoryMaterialAggregateModelOutput(
    {
      summary: "Concrete material facts are merged without technique abstraction.",
      findings: input.materialKinds.map((materialKind) => {
        const predecessor = requireMaterialFinding(input.verifiedFindings, materialKind);
        return {
          materialKind,
          title: `${materialKind} aggregate fact`,
          content: `The aggregate preserves the concrete ${materialKind} fact.`,
          details: [`Merged ${materialKind} evidence remains traceable.`],
          assertionType: "fact" as const,
          confidence: "medium" as const,
          sourceFindingRefs: [predecessor.id],
          uncertainty: null,
        };
      }),
      uncertainties: [],
    },
    {
      runId,
      unit: input.unit,
      materialKinds: input.materialKinds,
      verifiedFindings: materialFindingMap(input.verifiedFindings),
      coveredUnitIds: input.coveredUnitIds,
      coveredChapterIds: input.coveredChapterIds,
    },
  );
}

function materialProjectionOutput(runId: string, input: MaterialReductionFixtureInput) {
  return normalizeReferenceStoryMaterialProjectionModelOutput(
    {
      entries: input.materialKinds
        .map((materialKind) => {
          const predecessor = requireMaterialFinding(input.verifiedFindings, materialKind);
          return {
            materialKind,
            title: `${materialKind} projected entry`,
            content: `The projection keeps the accepted ${materialKind} fact concrete.`,
            details: [`Projected ${materialKind} evidence remains traceable.`],
            assertionType: "fact" as const,
            confidence: "medium" as const,
            sourceFindingRefs: [predecessor.id],
            uncertainty: null,
          };
        })
        .flatMap((entry) =>
          entry.materialKind === "timeline"
            ? [
                entry,
                {
                  ...entry,
                  title: "Other timeline entry",
                  content: "Another concrete timeline fact.",
                },
              ]
            : [entry],
        ),
      uncertainties: [],
    },
    {
      runId,
      unit: input.unit,
      materialKinds: input.materialKinds,
      verifiedFindings: materialFindingMap(input.verifiedFindings),
      coveredUnitIds: input.coveredUnitIds,
      coveredChapterIds: input.coveredChapterIds,
    },
  );
}

interface MaterialReductionFixtureInput {
  unit: ReferenceDeconstructionWorkUnit;
  materialKinds: readonly ReferenceStoryMaterialKind[];
  verifiedFindings: readonly ReferenceStoryMaterialFinding[];
  coveredUnitIds: readonly string[];
  coveredChapterIds: readonly string[];
}

function requireMaterialFinding(
  findings: readonly ReferenceStoryMaterialFinding[],
  materialKind: ReferenceStoryMaterialKind,
): ReferenceStoryMaterialFinding {
  const finding = findings.find(
    (candidate) => candidate.track === "storyMaterial" && candidate.materialKind === materialKind,
  );
  if (!finding) throw new Error(`Missing ${materialKind} Story Material fixture finding.`);
  return finding;
}

function materialFindingMap(findings: readonly ReferenceStoryMaterialFinding[]) {
  return Object.fromEntries(findings.map((finding) => [finding.id, finding]));
}
