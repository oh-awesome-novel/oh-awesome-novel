import type { RuntimeSkill, RuntimeTool, RuntimeToolRegistry } from './types';

export class InMemoryRuntimeToolRegistry implements RuntimeToolRegistry {
  private readonly tools = new Map<string, RuntimeTool>();

  constructor(tools: RuntimeTool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: RuntimeTool): void {
    this.tools.set(tool.id, tool);
  }

  get(id: string): RuntimeTool | undefined {
    return this.tools.get(id);
  }

  list(): RuntimeTool[] {
    return [...this.tools.values()];
  }

  listForSkill(skill: RuntimeSkill | undefined): RuntimeTool[] {
    const tools = this.list();

    if (!skill?.allowedTools?.length) {
      return tools;
    }

    const allowed = new Set(skill.allowedTools);

    return tools.filter(
      (tool) =>
        allowed.has(tool.id) ||
        tool.allowedInSkills?.includes(skill.name),
    );
  }
}
