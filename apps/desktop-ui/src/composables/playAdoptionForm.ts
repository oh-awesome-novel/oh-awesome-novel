import type { PlayAdoptionTarget } from './useWorkspaceApi';

/**
 * Typed forms for the four Play adoption targets. Each form is a lossless
 * view over the server's default payload: fields the form does not show (ids,
 * evidence fingerprints, source tags) are carried through unchanged, so the
 * produced payload keeps the existing backend contract.
 */

export interface ChapterDraftForm {
  target: 'chapterDraft';
  chapterId: string;
  title: string;
  content: string;
  mode: 'create' | 'replace' | '';
}

export interface StateRow {
  key: string;
  value: string;
  /** The original value was not a string; edit it as JSON. */
  json: boolean;
}

export interface StateForm {
  target: 'state';
  file: string;
  path: string;
  /** Row mode writes an object; scalar mode writes one value at `path`. */
  shape: 'rows' | 'scalar';
  rows: StateRow[];
  scalar: StateRow;
}

export interface TimelineForm {
  target: 'timeline';
  summary: string;
  date: string;
  participants: string;
  location: string;
}

export interface ForeshadowForm {
  target: 'foreshadow';
  summary: string;
  firstChapter: string;
  expectedResolution: string;
}

export type PlayAdoptionForm = ChapterDraftForm | StateForm | TimelineForm | ForeshadowForm;

export type PlayAdoptionFieldErrors = Record<string, string>;

export const PLAY_ADOPTION_TARGET_LABELS: Record<PlayAdoptionTarget, string> = {
  chapterDraft: '章节草稿',
  state: '状态',
  timeline: '时间线',
  foreshadow: '伏笔',
};

const MAX_CHAPTER_CONTENT = 1_000_000;
const MAX_CHAPTER_TITLE = 1_000;
const MAX_ENTRY_TEXT = 4_000;
const YAML_SEGMENT = /^[\p{L}\p{N}_-]+$/u;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export function formFromPayload(
  target: PlayAdoptionTarget,
  payload: Readonly<Record<string, unknown>>,
): PlayAdoptionForm {
  if (target === 'chapterDraft') {
    return {
      target,
      chapterId: text(payload.chapterId),
      title: text(payload.title),
      content: text(payload.content),
      mode: payload.mode === 'create' || payload.mode === 'replace' ? payload.mode : '',
    };
  }
  if (target === 'state') {
    const value = payload.value;
    const rows = isRecord(value)
      ? Object.entries(value).map(([key, item]) => toRow(key, item))
      : [];
    return {
      target,
      file: text(payload.file),
      path: text(payload.path),
      shape: isRecord(value) || value === undefined ? 'rows' : 'scalar',
      rows: rows.length ? rows : [{ key: '', value: '', json: false }],
      scalar: toRow('', isRecord(value) ? '' : value ?? ''),
    };
  }
  if (target === 'timeline') {
    const event = isRecord(payload.event) ? payload.event : {};
    return {
      target,
      summary: text(event.summary),
      date: text(event.date),
      participants: Array.isArray(event.participants)
        ? event.participants.filter((item): item is string => typeof item === 'string').join('、')
        : text(event.participants),
      location: text(event.location),
    };
  }
  const item = isRecord(payload.item) ? payload.item : {};
  return {
    target: 'foreshadow',
    summary: text(item.summary),
    firstChapter: text(item.firstChapter),
    expectedResolution: text(item.expectedResolution),
  };
}

/**
 * Builds the payload for `form` on top of `base` (the server's default or the
 * last previewed payload). Returns field-level errors instead of a payload
 * when the backend would reject the input.
 */
export function payloadFromForm(
  form: Readonly<PlayAdoptionForm>,
  base: Readonly<Record<string, unknown>>,
): { payload?: Record<string, unknown>; errors: PlayAdoptionFieldErrors } {
  const errors: PlayAdoptionFieldErrors = {};
  if (form.target === 'chapterDraft') {
    const content = form.content.trim();
    const title = form.title.trim();
    if (!/^\d{4}\/\d{4}$/u.test(form.chapterId) || form.chapterId.endsWith('/0000')) {
      errors.chapterId = '目标章节无效。';
    }
    if (!content) errors.content = '请填写正文。';
    else if (content.length > MAX_CHAPTER_CONTENT) errors.content = `正文不能超过 ${MAX_CHAPTER_CONTENT} 字。`;
    if (title.length > MAX_CHAPTER_TITLE) errors.title = `标题不能超过 ${MAX_CHAPTER_TITLE} 字。`;
    if (Object.keys(errors).length) return { errors };
    const payload: Record<string, unknown> = { ...base, chapterId: form.chapterId, content };
    if (title) payload.title = title;
    else delete payload.title;
    if (form.mode) payload.mode = form.mode;
    else delete payload.mode;
    return { payload, errors };
  }

  if (form.target === 'state') {
    const file = form.file.trim();
    const path = form.path.trim();
    const fileError = yamlFileError(file);
    if (fileError) errors.file = fileError;
    const pathError = dottedPathError(path);
    if (pathError) errors.path = pathError;
    let value: unknown;
    if (form.shape === 'scalar') {
      const parsed = rowValue(form.scalar);
      if ('error' in parsed) errors['scalar'] = parsed.error;
      else value = parsed.value;
    } else {
      const object: Record<string, unknown> = {};
      form.rows.forEach((row, index) => {
        const key = row.key.trim();
        if (!key && !row.value.trim()) return;
        if (!key) errors[`rows.${index}.key`] = '请填写字段名。';
        else if (!YAML_SEGMENT.test(key) || FORBIDDEN_SEGMENTS.has(key)) errors[`rows.${index}.key`] = '字段名只能包含文字、数字、下划线或连字符。';
        else if (Object.hasOwn(object, key)) errors[`rows.${index}.key`] = '字段名重复。';
        const parsed = rowValue(row);
        if ('error' in parsed) errors[`rows.${index}.value`] = parsed.error;
        else if (key) object[key] = parsed.value;
      });
      if (!Object.keys(object).length && !Object.keys(errors).some((key) => key.startsWith('rows.'))) {
        errors.rows = '至少填写一行。';
      }
      value = object;
    }
    if (Object.keys(errors).length) return { errors };
    return { payload: { ...base, file, path, value }, errors };
  }

  if (form.target === 'timeline') {
    const summary = form.summary.trim();
    if (!summary) errors.summary = '请填写事件。';
    else if (summary.length > MAX_ENTRY_TEXT) errors.summary = `事件不能超过 ${MAX_ENTRY_TEXT} 字。`;
    if (Object.keys(errors).length) return { errors };
    const participants = form.participants
      .split(/[、,，;；\n]/u)
      .map((item) => item.trim())
      .filter(Boolean);
    const event = withOptional({ ...(isRecord(base.event) ? base.event : {}), summary }, {
      date: form.date.trim(),
      location: form.location.trim(),
    });
    if (participants.length) event.participants = participants;
    else delete event.participants;
    return { payload: { ...base, event }, errors };
  }

  const summary = form.summary.trim();
  if (!summary) errors.summary = '请填写伏笔描述。';
  else if (summary.length > MAX_ENTRY_TEXT) errors.summary = `伏笔描述不能超过 ${MAX_ENTRY_TEXT} 字。`;
  if (Object.keys(errors).length) return { errors };
  const item = withOptional({ ...(isRecord(base.item) ? base.item : {}), summary }, {
    firstChapter: form.firstChapter.trim(),
    expectedResolution: form.expectedResolution.trim(),
  });
  return { payload: { ...base, item }, errors };
}

function withOptional(
  value: Record<string, unknown>,
  optional: Record<string, string>,
): Record<string, unknown> {
  const next = { ...value };
  for (const [key, item] of Object.entries(optional)) {
    if (item) next[key] = item;
    else delete next[key];
  }
  return next;
}

function toRow(key: string, value: unknown): StateRow {
  return typeof value === 'string'
    ? { key, value, json: false }
    : { key, value: JSON.stringify(value) ?? '', json: true };
}

function rowValue(row: Readonly<StateRow>): { value: unknown } | { error: string } {
  if (!row.json) return { value: row.value };
  try {
    return { value: JSON.parse(row.value) as unknown };
  } catch {
    return { error: '这个值需要是有效的 JSON（数字、true/false、列表或对象）。' };
  }
}

function yamlFileError(file: string): string | undefined {
  if (!file) return '请填写文件名。';
  if (
    file.includes('\\') ||
    file.startsWith('/') ||
    file.split('/').some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))
  ) {
    return '文件名必须是安全的相对路径。';
  }
  if (!file.endsWith('.yaml')) return '文件名必须以 .yaml 结尾。';
  return undefined;
}

function dottedPathError(path: string): string | undefined {
  if (!path) return '请填写对象路径。';
  return path.split('.').every((segment) => YAML_SEGMENT.test(segment) && !FORBIDDEN_SEGMENTS.has(segment))
    ? undefined
    : '对象路径只能由文字、数字、下划线、连字符和点组成。';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
