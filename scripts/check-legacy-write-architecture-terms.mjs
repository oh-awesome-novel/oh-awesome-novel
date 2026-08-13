import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LEGACY_TERMS = [
  /SemanticPatch/u,
  /ObjectPatch/u,
  /CollectionPatch/u,
  /NarrativePatch/u,
  /ReferenceArtifactPatch/u,
  /PreparedWriteIntentPreview/u,
  /WriteIntentPendingAction/u,
  /ShadowWriteReference/u,
  /previewSemanticPatches/u,
  /resolvePatchTargetFile/u,
  /prepareWriteIntentPreview/u,
  /promoteWriteIntentPreview/u,
  /validateWriteIntentPreview/u,
  /WRITE_INTENT_PREVIEW_SCHEMA_VERSION/u,
  /PreviewableWriteIntentToolName/u,
  /createReferenceMaterialAdoptionPatches/u,
  /proposedPatches/u,
  /proposed-patches/u,
  /createWriteIntentTools/u,
  /createRestrictedWriteTools/u,
  /workspace\.writeFile/u,
  /workspace\.proposeWrite/u,
  /chapter\.createDraft/u,
  /character\.updatePersonality/u,
  /state\.set/u,
  /timeline\.add/u,
  /foreshadow\.create/u,
  /summary\.generateChapter/u,
  /reference\.adoptMaterials/u,
  /\bwrite-intent\b/iu,
  /\bwrite intent\b/iu,
  /\bshadow writes?\b/iu,
  /\bApply Engine\b/u,
  /APPLY_ENGINE\.md/u,
];

function collectMarkdownFiles(relativeDirectory) {
  const absoluteDirectory = resolve(repositoryRoot, relativeDirectory);
  const files = [];

  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(relativePath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relativePath);
    }
  }

  return files;
}

// Default-deny: every repository-owned Markdown contract, spec, plan, task and
// reference analysis is scanned. New docs cannot silently fall outside the gate.
const MARKDOWN_FILES = [
  'AGENTS.md',
  'README.md',
  ...collectMarkdownFiles('docs'),
].sort();

// Whole-file exceptions are limited to immutable decision/history sources.
// Reference analyses and task 0800 are deliberately not exempted wholesale.
const EXACT_WHOLE_FILE_ALLOWLIST = new Set([
  'docs/adr/0003-semantic-patch-apply-engine.md',
  'docs/adr/0004-sandbox-change-engine.md',
  'docs/superpowers/plans/2026-06-10-align-apply-engine-implementation-order.md',
  'docs/superpowers/plans/2026-08-12-migrate-semantic-patch-to-sandbox-change-engine.md',
  'docs/ChatGPT对话.md',
]);

// These dated implementation plans describe already-completed slices. They are
// exact, explicitly marked historical records; current product/spec documents
// never enter this allowlist.
const EXACT_HISTORICAL_PLAN_ALLOWLIST = new Set([
  'docs/superpowers/plans/2026-06-10-align-monorepo-source-layout.md',
  'docs/superpowers/plans/2026-06-10-align-tool-scope-roadmap.md',
  'docs/superpowers/plans/2026-06-10-clarify-shadow-write-approval-boundary.md',
  'docs/superpowers/plans/2026-06-10-pending-action-accept-auto-commit.md',
  'docs/superpowers/plans/2026-06-10-retire-storyforge-current-naming.md',
  'docs/superpowers/plans/2026-06-10-stable-numbered-chapter-paths.md',
  'docs/superpowers/plans/2026-06-10-unify-ai-sdk-toolset-tool-registry.md',
  'docs/superpowers/plans/2026-06-10-unify-oan-workspace-runtime-dir.md',
  'docs/superpowers/plans/2026-06-19-agent-context-trace-session-autowiring.md',
  'docs/superpowers/plans/2026-06-19-planning-and-prewrite-workflow.md',
  'docs/superpowers/plans/2026-06-19-play-mode-ui-adoption-workflow.md',
  'docs/superpowers/plans/2026-06-19-projections-project-health.md',
  'docs/superpowers/plans/2026-06-19-review-and-settlement-workflow.md',
  'docs/superpowers/plans/2026-06-19-session-artifacts-author-reports.md',
  'docs/superpowers/plans/2026-07-16-play-evidence-adoption-m4.md',
  'docs/superpowers/plans/2026-07-16-play-outcome-writing-handoff-f3.md',
  'docs/superpowers/plans/2026-07-26-reference-work-deep-deconstruction-d4.md',
  'docs/superpowers/plans/2026-07-31-reference-story-material-analysis-track.md',
]);

const EXACT_SECTION_ALLOWLIST = new Map([
  [
    'docs/tasks/0800.md',
    new Set(['Related Plans', 'Goal', 'Scope']),
  ],
]);

const requiredAssertions = [
  {
    file: 'docs/adr/0003-semantic-patch-apply-engine.md',
    pattern: /^Superseded by \[ADR 0004:/mu,
    message: 'ADR 0003 must remain explicitly Superseded by ADR 0004.',
  },
  {
    file: 'docs/superpowers/plans/2026-06-10-align-apply-engine-implementation-order.md',
    pattern: /Status: Superseded by ADR 0004/u,
    message: 'The old implementation-order plan must remain explicitly Superseded.',
  },
  {
    file: 'docs/tasks/0800.md',
    pattern: /^> Status: Needs Review$/mu,
    message: 'Task 0800 must stay Needs Review until every implementation gate passes.',
  },
  {
    file: 'docs/ChatGPT对话.md',
    pattern: /^> Status: Historical raw conversation transcript; not a current OAN contract\.$/mu,
    message: 'The raw conversation transcript must remain explicitly historical.',
  },
];

for (const file of EXACT_HISTORICAL_PLAN_ALLOWLIST) {
  requiredAssertions.push({
    file,
    pattern: /^> \*\*Status: Historical implementation record \(dated \d{4}-\d{2}-\d{2}\)\. Current write architecture is governed by ADR 0004; do not reuse legacy write APIs from this plan\.\*\*$/mu,
    message: 'Historical implementation plans must carry the exact dated ADR 0004 marker.',
  });
}

const failures = [];

if (existsSync(resolve(repositoryRoot, 'docs/APPLY_ENGINE.md'))) {
  failures.push('docs/APPLY_ENGINE.md: compatibility tombstone must not exist');
}

if (!existsSync(resolve(repositoryRoot, 'docs/SANDBOX_CHANGE_ENGINE.md'))) {
  failures.push('docs/SANDBOX_CHANGE_ENGINE.md: renamed stable document is missing');
}

for (const assertion of requiredAssertions) {
  const absolutePath = resolve(repositoryRoot, assertion.file);
  if (!existsSync(absolutePath)) {
    failures.push(`${assertion.file}: required allowlisted file is missing`);
    continue;
  }
  const content = readFileSync(absolutePath, 'utf8');
  if (!assertion.pattern.test(content)) {
    failures.push(`${assertion.file}: ${assertion.message}`);
  }
}

const filesToScan = [...new Set(MARKDOWN_FILES)].sort();

for (const file of filesToScan) {
  const absolutePath = resolve(repositoryRoot, file);
  if (!existsSync(absolutePath)) {
    failures.push(`${file}: configured checker target is missing`);
    continue;
  }

  const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/u);
  const allowWholeFile = EXACT_WHOLE_FILE_ALLOWLIST.has(file);
  const allowHistoricalPlan = EXACT_HISTORICAL_PLAN_ALLOWLIST.has(file);
  const allowedSections = EXACT_SECTION_ALLOWLIST.get(file) ?? new Set();
  let inHistoricalImplementationNotes = false;
  let historicalDateSeen = false;
  let currentH2 = '';

  for (const [index, line] of lines.entries()) {
    if (line.startsWith('## ')) {
      currentH2 = line.slice(3).trim();
      inHistoricalImplementationNotes = currentH2 === 'Historical Implementation Notes';
      historicalDateSeen = false;
    } else if (
      inHistoricalImplementationNotes
      && (/^### \d{4}-\d{2}-\d{2}(?:\s|（|$)/u.test(line)
        || /^\d{4}-\d{2}-\d{2}(?:\s|（|$)/u.test(line))
    ) {
      historicalDateSeen = true;
    }

    for (const term of LEGACY_TERMS) {
      term.lastIndex = 0;
      if (!term.test(line)) {
        continue;
      }

      const allowedHistoricalSection = inHistoricalImplementationNotes && historicalDateSeen;
      const allowedExactSection = allowedSections.has(currentH2);
      if (
        !allowWholeFile
        && !allowHistoricalPlan
        && !allowedHistoricalSection
        && !allowedExactSection
      ) {
        failures.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write([
    'Legacy write-architecture term check failed:',
    ...failures.map((failure) => `- ${failure}`),
    '',
  ].join('\n'));
  process.exitCode = 1;
} else {
  const workspaceLabel = relative(repositoryRoot, resolve(repositoryRoot, 'docs')) || 'docs';
  process.stdout.write(
    `Legacy write-architecture term check passed (${filesToScan.length} Markdown files; ${workspaceLabel} default-deny scan + exact historical allowlist).\n`,
  );
}
