import { parse, stringify } from 'yaml';

/** Compile a dotted YAML set into the complete final document bytes. */
export function compileYamlSetFinalDocument(
  baseline: string,
  rawPath: string,
  value: unknown,
): string {
  const document = parseBaseline(baseline, true);
  const path = parseDeterministicYamlPath(rawPath);
  const parent = ensureParent(document, path);
  const key = path.at(-1)!;
  if (isRecord(parent) && typeof key === 'string') {
    parent[key] = structuredClone(value);
  } else if (Array.isArray(parent) && typeof key === 'number') {
    parent[key] = structuredClone(value);
  } else {
    throw new Error(`Cannot set YAML path "${rawPath}".`);
  }
  return stringify(document);
}

/** Compile a dotted YAML append into the complete final document bytes. */
export function compileYamlAppendFinalDocument(
  baseline: string,
  rawPath: string,
  value: unknown,
): string {
  const document = parseBaseline(baseline, false);
  const path = parseDeterministicYamlPath(rawPath);
  const target = getByPath(document, path);
  if (!Array.isArray(target)) {
    throw new Error(`YAML path "${rawPath}" is not an array.`);
  }
  target.push(structuredClone(value));
  return stringify(document);
}

export function parseDeterministicYamlPath(
  value: string,
): Array<string | number> {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Deterministic YAML path is required.');
  }
  const segments = value.split('.');
  if (segments.some((segment) =>
    !segment
    || !/^[\p{L}\p{N}_-]+$/u.test(segment)
    || ['__proto__', 'prototype', 'constructor'].includes(segment))) {
    throw new Error(`Deterministic YAML path is invalid: ${value}.`);
  }
  return segments.map((segment) => /^\d+$/u.test(segment) ? Number(segment) : segment);
}

function parseBaseline(baseline: string, initializeEmpty: boolean): unknown {
  try {
    const parsed = baseline.trim() ? parse(baseline) : initializeEmpty ? {} : undefined;
    if (parsed === undefined) throw new Error('YAML document is empty.');
    return parsed;
  } catch (error) {
    throw new Error(
      `Deterministic YAML baseline is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function getByPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') {
      current = current[segment];
    } else if (
      isRecord(current)
      && typeof segment === 'string'
      && Object.hasOwn(current, segment)
    ) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function ensureParent(
  value: unknown,
  path: readonly (string | number)[],
): Record<string, unknown> | unknown[] {
  if (path.length === 0) throw new Error('Deterministic YAML path must not be empty.');
  let current = value;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!;
    const next = path[index + 1]!;
    if (isRecord(current) && typeof segment === 'string') {
      if (!isRecord(current[segment]) && !Array.isArray(current[segment])) {
        current[segment] = typeof next === 'number' ? [] : {};
      }
      current = current[segment];
    } else if (Array.isArray(current) && typeof segment === 'number') {
      if (!isRecord(current[segment]) && !Array.isArray(current[segment])) {
        current[segment] = typeof next === 'number' ? [] : {};
      }
      current = current[segment];
    } else {
      throw new Error(`Cannot traverse YAML path "${path.join('.')}".`);
    }
  }
  if (!isRecord(current) && !Array.isArray(current)) {
    throw new Error(`Cannot traverse YAML path "${path.join('.')}".`);
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
