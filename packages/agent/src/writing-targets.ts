import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  NOVEL_COPILOT_QUICK_COMMANDS,
  type NovelCopilotCapabilityId,
} from '@oh-awesome-novel/core';

/**
 * Standard object files of one character directory (see FILESYSTEM_SPEC).
 * The host grants exactly these paths; the model cannot add other files.
 */
export const CHARACTER_OBJECT_FILES = Object.freeze([
  'meta.yaml',
  'summary.md',
  'personality.md',
  'appearance.md',
  'growth.md',
  'relationships.yaml',
]);

const CHARACTER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const TARGETED_COMMANDS = new Set<NovelCopilotCapabilityId>([
  'novel.write_chapter',
  'novel.generate_character_card',
  'novel.plan_outline',
  'novel.plan_volume',
  'novel.plan_chapter',
]);

export interface WritingCommandTargets {
  capability: NovelCopilotCapabilityId;
  exactWritablePaths: string[];
  /** Author-facing explanation of why these targets were chosen. */
  note: string;
}

export class WritingCommandTargetError extends Error {
  readonly code = 'WRITING_COMMAND_TARGET_INVALID';
}

/**
 * Derives exact write targets for explicit slash commands whose target the
 * author should not have to pick by hand. Only a leading slash command counts:
 * keyword-inferred requests keep the selected-file behaviour, so "改写这一章"
 * never silently moves to a new chapter. Returns undefined when the request is
 * not one of these commands, leaving the caller's selection untouched.
 */
export async function resolveWritingCommandTargets(input: {
  workspaceRoot: string;
  request: string;
  selectedPaths: readonly string[];
}): Promise<WritingCommandTargets | undefined> {
  const request = input.request.trim();
  const command = NOVEL_COPILOT_QUICK_COMMANDS.find((candidate) => (
    TARGETED_COMMANDS.has(candidate.capabilityId)
    && request.startsWith(candidate.slashCommand)
    && (request.length === candidate.slashCommand.length
      || /^[\s，。,:：;；!?！？]/u.test(request.slice(candidate.slashCommand.length)))
  ));
  if (!command) return undefined;
  const argument = request.slice(command.slashCommand.length).split(/\r?\n/u)[0]!.trim();
  const chapters = await listChapterPositions(input.workspaceRoot);

  switch (command.capabilityId) {
    case 'novel.write_chapter': {
      const path = nextChapterPath(chapters);
      return {
        capability: command.capabilityId,
        exactWritablePaths: [path],
        note: `写下一章的目标文件由系统确定为 ${path}。`,
      };
    }
    case 'novel.generate_character_card': {
      const selected = input.selectedPaths
        .map((path) => /^characters\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\//u.exec(path)?.[1])
        .find((id): id is string => Boolean(id));
      // Only an ASCII token right after the command is an ID; prose such as
      // 「/生成角色卡 林照，十七岁……」 is a description, not a folder name.
      const token = /^[^\s，。,:：;；!?！？]+/u.exec(argument)?.[0];
      const requested = token && /^[A-Za-z0-9._-]+$/u.test(token) ? token : undefined;
      const characterId = requested ?? selected;
      if (!characterId) {
        return {
          capability: command.capabilityId,
          exactWritablePaths: [],
          note: '没有选中角色文件，也没有给出角色 ID，本轮只能讨论；保存角色卡请使用「/生成角色卡 角色ID」。',
        };
      }
      if (!CHARACTER_ID.test(characterId)) {
        throw new WritingCommandTargetError(
          `角色 ID「${characterId}」无效：只能使用英文字母、数字、点、下划线或连字符，以字母或数字开头，最多 64 个字符。`,
        );
      }
      return {
        capability: command.capabilityId,
        exactWritablePaths: CHARACTER_OBJECT_FILES.map((file) => `characters/${characterId}/${file}`),
        note: `角色卡保存在 characters/${characterId}/。`,
      };
    }
    case 'novel.plan_outline':
    case 'novel.plan_chapter': {
      const volume = activeVolume(chapters, input.selectedPaths);
      const paths = ['outline/main.md', `outline/volumes/${volume}.md`];
      return {
        capability: command.capabilityId,
        exactWritablePaths: paths,
        note: `需要保存时写入 ${paths.join(' 或 ')}。`,
      };
    }
    case 'novel.plan_volume': {
      const latest = chapters.at(-1)?.volume;
      const volume = pad(latest === undefined ? 1 : latest + 1, '卷号');
      const paths = ['outline/main.md', `outline/volumes/${volume}.md`];
      return {
        capability: command.capabilityId,
        exactWritablePaths: paths,
        note: `需要保存时写入 ${paths.join(' 或 ')}。`,
      };
    }
    default:
      return undefined;
  }
}

interface ChapterPosition {
  volume: number;
  chapter: number;
}

/** Numbered chapter files in numeric order; `0000.md` is volume metadata. */
async function listChapterPositions(workspaceRoot: string): Promise<ChapterPosition[]> {
  const positions: ChapterPosition[] = [];
  const volumes = await readDirectoryEntries(join(workspaceRoot, 'chapters'));
  for (const volume of volumes) {
    if (!volume.isDirectory() || !/^\d{4}$/u.test(volume.name)) continue;
    const files = await readDirectoryEntries(join(workspaceRoot, 'chapters', volume.name));
    const chapters = files.filter((file) => file.isFile() && /^\d{4}\.md$/u.test(file.name) && file.name !== '0000.md');
    if (!chapters.length) positions.push({ volume: Number(volume.name), chapter: 0 });
    for (const file of chapters) {
      positions.push({ volume: Number(volume.name), chapter: Number(file.name.slice(0, 4)) });
    }
  }
  return positions.sort((a, b) => a.volume - b.volume || a.chapter - b.chapter);
}

async function readDirectoryEntries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function nextChapterPath(chapters: readonly ChapterPosition[]): string {
  const latest = chapters.at(-1);
  if (!latest) return 'chapters/0001/0001.md';
  return `chapters/${pad(latest.volume, '卷号')}/${pad(latest.chapter + 1, '章号')}.md`;
}

function activeVolume(chapters: readonly ChapterPosition[], selectedPaths: readonly string[]): string {
  for (const path of selectedPaths) {
    const volume = /^(?:chapters|outline\/volumes|summaries\/volume|summaries\/chapter)\/(\d{4})(?:\/|\.md$)/u.exec(path)?.[1];
    if (volume && volume !== '0000') return volume;
  }
  return pad(chapters.at(-1)?.volume ?? 1, '卷号');
}

function pad(value: number, label: string): string {
  if (!Number.isInteger(value) || value < 1 || value > 9999) {
    throw new WritingCommandTargetError(`${label}超出 0001–9999 范围，无法自动确定目标文件。`);
  }
  return String(value).padStart(4, '0');
}
