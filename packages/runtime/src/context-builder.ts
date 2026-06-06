import type {
  RuntimeContextBuilder,
  RuntimeContextBuilderInput,
  RuntimeContextItem,
  RuntimeMessage,
} from './types';

const contextOrder: RuntimeContextItem['kind'][] = [
  'constitution',
  'workflow',
  'skill',
  'selected',
  'summary',
  'state',
  'timeline',
  'foreshadow',
];

const contextLabels: Record<RuntimeContextItem['kind'], string> = {
  constitution: 'Novel Constitution',
  workflow: 'Workflow',
  skill: 'Skill Prompt',
  selected: 'Selected Context',
  summary: 'Summary',
  state: 'State',
  timeline: 'Timeline',
  foreshadow: 'Foreshadow',
};

export class PriorityRuntimeContextBuilder implements RuntimeContextBuilder {
  build(input: RuntimeContextBuilderInput): RuntimeMessage[] {
    const contextMessages = this.buildContextMessages(input);

    return [
      ...contextMessages,
      ...input.doneMessages,
      ...input.curMessages,
    ];
  }

  private buildContextMessages(
    input: RuntimeContextBuilderInput,
  ): RuntimeMessage[] {
    const context = [...(input.context ?? [])];

    if (input.skill?.system) {
      context.push({
        kind: 'skill',
        title: input.skill.name,
        content: input.skill.system,
      });
    }

    return context
      .sort(
        (a, b) =>
          contextOrder.indexOf(a.kind) - contextOrder.indexOf(b.kind),
      )
      .map((item) => ({
        role: 'system' as const,
        content: this.formatContextItem(item),
      }));
  }

  private formatContextItem(item: RuntimeContextItem): string {
    const label = contextLabels[item.kind];
    const title = item.title ? `: ${item.title}` : '';
    return `# ${label}${title}\n\n${item.content}`;
  }
}
