import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';

export type YamlValue =
  | null
  | string
  | number
  | boolean
  | YamlValue[]
  | { [key: string]: YamlValue };

export interface YamlDocument {
  filePath: string;
  raw: string;
  data: unknown;
}

export interface YamlDraft {
  filePath: string;
  original: string;
  draft: string;
  data: unknown;
}

export async function loadYaml(filePath: string): Promise<YamlDocument> {
  const raw = await readFile(filePath, 'utf-8');
  return {
    filePath,
    raw,
    data: parse(raw),
  };
}

export async function yamlGet(
  filePath: string,
  path: string,
): Promise<unknown> {
  const document = await loadYaml(filePath);
  return getByPath(document.data, parseYamlPath(path));
}

export async function yamlSetDraft(
  filePath: string,
  path: string,
  value: unknown,
): Promise<YamlDraft> {
  const { raw, data } = await loadYaml(filePath);
  const nextData = cloneYamlData(data);
  setByPath(nextData, parseYamlPath(path), value);

  return toDraft(filePath, raw, nextData);
}

export async function yamlDeleteDraft(
  filePath: string,
  path: string,
): Promise<YamlDraft> {
  const { raw, data } = await loadYaml(filePath);
  const nextData = cloneYamlData(data);
  deleteByPath(nextData, parseYamlPath(path));

  return toDraft(filePath, raw, nextData);
}

export async function yamlAppendDraft(
  filePath: string,
  path: string,
  value: unknown,
): Promise<YamlDraft> {
  const { raw, data } = await loadYaml(filePath);
  const nextData = cloneYamlData(data);
  const target = getByPath(nextData, parseYamlPath(path));

  if (!Array.isArray(target)) {
    throw new Error(`YAML path "${path}" is not an array.`);
  }

  target.push(value);

  return toDraft(filePath, raw, nextData);
}

export function validateYamlDocument(data: unknown): {
  ok: boolean;
  errors: string[];
} {
  if (data === undefined) {
    return {
      ok: false,
      errors: ['YAML document is empty.'],
    };
  }

  return { ok: true, errors: [] };
}

function toDraft(filePath: string, original: string, data: unknown): YamlDraft {
  return {
    filePath,
    original,
    data,
    draft: stringify(data),
  };
}

function parseYamlPath(path: string): Array<string | number> {
  if (!path.trim()) {
    return [];
  }

  const parts = path.split('.');
  if (parts.some((part) => !part.trim())) {
    throw new Error(`YAML path "${path}" contains an empty segment.`);
  }

  const dangerous = parts.find((part) => DANGEROUS_PATH_SEGMENTS.has(part));
  if (dangerous) {
    throw new Error(`YAML path "${path}" contains forbidden segment "${dangerous}".`);
  }

  return parts.map((part) => {
    if (/^\d+$/.test(part)) {
      return Number(part);
    }
    return part;
  });
}

function getByPath(value: unknown, path: Array<string | number>): unknown {
  let current = value;

  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') {
      current = current[segment];
      continue;
    }

    if (
      isRecord(current) &&
      typeof segment === 'string' &&
      Object.hasOwn(current, segment)
    ) {
      current = current[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

function setByPath(
  value: unknown,
  path: Array<string | number>,
  nextValue: unknown,
): void {
  if (path.length === 0) {
    throw new Error('YAML set path must not be empty.');
  }

  const parent = ensureParent(value, path);
  const key = path.at(-1);

  if (Array.isArray(parent) && typeof key === 'number') {
    parent[key] = nextValue;
    return;
  }

  if (isRecord(parent) && typeof key === 'string') {
    parent[key] = nextValue;
    return;
  }

  throw new Error(`Cannot set YAML path "${path.join('.')}".`);
}

function deleteByPath(value: unknown, path: Array<string | number>): void {
  if (path.length === 0) {
    throw new Error('YAML delete path must not be empty.');
  }

  const parent = getByPath(value, path.slice(0, -1));
  const key = path.at(-1);

  if (Array.isArray(parent) && typeof key === 'number') {
    parent.splice(key, 1);
    return;
  }

  if (isRecord(parent) && typeof key === 'string') {
    delete parent[key];
    return;
  }

  throw new Error(`Cannot delete YAML path "${path.join('.')}".`);
}

function ensureParent(
  value: unknown,
  path: Array<string | number>,
): Record<string, unknown> | unknown[] {
  let current = value;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];

    if (isRecord(current) && typeof segment === 'string') {
      if (
        !Object.hasOwn(current, segment) ||
        (!isRecord(current[segment]) && !Array.isArray(current[segment]))
      ) {
        current[segment] = typeof nextSegment === 'number' ? [] : {};
      }
      current = current[segment];
      continue;
    }

    if (Array.isArray(current) && typeof segment === 'number') {
      if (!isRecord(current[segment]) && !Array.isArray(current[segment])) {
        current[segment] = typeof nextSegment === 'number' ? [] : {};
      }
      current = current[segment];
      continue;
    }

    throw new Error(`Cannot traverse YAML path "${path.join('.')}".`);
  }

  if (!isRecord(current) && !Array.isArray(current)) {
    throw new Error(`Cannot traverse YAML path "${path.join('.')}".`);
  }

  return current;
}

function cloneYamlData(value: unknown): unknown {
  return value === undefined ? {} : structuredClone(value);
}

const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
