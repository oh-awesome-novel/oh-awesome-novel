// Image generation services (task 1640): config state, request/result contracts and the
// pure pieces of the adapters. Nothing here touches the network or the filesystem.
// The config holds API keys and lives in the app-level config directory, never in a novel workspace.

export type ImageProviderKind = 'comfyui' | 'openai' | 'openai-compatible';
export const IMAGE_PROVIDER_KINDS: readonly ImageProviderKind[] = ['comfyui', 'openai', 'openai-compatible'];

export const IMAGE_GENERATION_LIMITS = {
  minSide: 64,
  maxSide: 4096,
  /** Images per request. */
  maxCount: 4,
  /** Bytes per returned image. */
  maxImageBytes: 16 * 1024 * 1024,
  minTimeoutMs: 5_000,
  maxTimeoutMs: 600_000,
  defaultTimeoutMs: 120_000,
  maxPromptChars: 4000,
  /** Bytes of an imported ComfyUI workflow. */
  maxWorkflowBytes: 1024 * 1024,
  maxLabel: 120,
} as const;

/** The values a ComfyUI workflow can take from a request. */
export const COMFY_WORKFLOW_SLOTS = ['positive', 'negative', 'seed', 'width', 'height', 'batch', 'lora'] as const;
export type ComfyWorkflowSlot = typeof COMFY_WORKFLOW_SLOTS[number];
/** Where one slot goes in an API-format workflow: a node id and one of its inputs. */
export interface ComfyWorkflowTarget { node: string; input: string }
export type ComfyWorkflowMapping = Partial<Record<ComfyWorkflowSlot, ComfyWorkflowTarget>>;

/** The imported workflow of a ComfyUI service. The file itself stays in the app config directory. */
export interface ImageProviderWorkflow {
  sha256: string;
  mapping: ComfyWorkflowMapping;
  /** Slots the workflow fills, through the mapping or a `{{slot}}` placeholder. */
  slots: ComfyWorkflowSlot[];
  importedAt: string;
}

export type ImageGenerationErrorCode =
  | 'unreachable'
  | 'auth'
  | 'timeout'
  | 'content_rejected'
  | 'invalid_response'
  | 'workflow'
  | 'cancelled'
  | 'config';

export class ImageGenerationError extends Error {
  readonly name = 'ImageGenerationError';
  readonly code: ImageGenerationErrorCode;
  constructor(code: ImageGenerationErrorCode, message: string) { super(message); this.code = code; }
}

export interface ImageProviderLastError { at: string; code: ImageGenerationErrorCode; message: string }

export interface ImageProviderConfig {
  id: string;
  kind: ImageProviderKind;
  displayName: string;
  /** ComfyUI address, or the base URL of an online API. */
  baseUrl: string;
  /** Online services only. A ComfyUI workflow names its own checkpoint. */
  model?: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultNegative?: string;
  timeoutMs: number;
  /** ComfyUI only: allow an address that is not on this machine. */
  allowRemote?: boolean;
  /** Stored in the app-level config. Never returned to the UI. */
  apiKey?: string;
  /** True on a redacted config that has a stored key. */
  hasApiKey?: boolean;
  workflow?: ImageProviderWorkflow;
  lastError?: ImageProviderLastError;
}

export interface ImageProviderConfigState { providers: ImageProviderConfig[] }

export interface PortraitImageRequest {
  positive: string;
  negative?: string;
  width: number;
  height: number;
  seed?: number;
  count: number;
  /** LoRA file name for a ComfyUI workflow that has a `lora` slot. */
  loraName?: string;
}
export interface PortraitImage { bytes: Uint8Array; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; seed?: number }
export interface PortraitImageResult { images: PortraitImage[]; providerMeta: Record<string, string | number> }

const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u;

function fail(message: string): never { throw new ImageGenerationError('config', message); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integerBetween(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be a whole number from ${min} to ${max}.`);
  return value as number;
}
function boundedText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || Array.from(value).length > max || CONTROL.test(value)) fail(`${label} is invalid.`);
  return value as string;
}

/** Whether a host name refers to this machine. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(host);
}

/** Accepts http(s) only and drops any path noise at the end; credentials in the URL are refused. */
export function normalizeImageProviderBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) fail('The service address is required.');
  let url: URL;
  try { url = new URL((value as string).trim()); } catch { return fail('The service address is not a valid URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') fail('The service address must start with http:// or https://.');
  if (url.username || url.password || url.search || url.hash) fail('The service address must not contain credentials, a query or a fragment.');
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`;
}

function normalizeMapping(value: unknown): ComfyWorkflowMapping {
  if (value === undefined) return {};
  if (!isRecord(value)) fail('The workflow mapping is invalid.');
  const mapping: ComfyWorkflowMapping = {};
  for (const [slot, target] of Object.entries(value as Record<string, unknown>)) {
    if (!(COMFY_WORKFLOW_SLOTS as readonly string[]).includes(slot)) fail(`Unknown workflow slot: ${slot}.`);
    if (target === undefined || target === null) continue;
    if (!isRecord(target) || typeof target.node !== 'string' || typeof target.input !== 'string') fail(`The workflow mapping for ${slot} needs a node id and an input name.`);
    const node = (target.node as string).trim();
    const input = (target.input as string).trim();
    if (!node && !input) continue;
    if (!node || !input || node.length > 64 || input.length > 64) fail(`The workflow mapping for ${slot} needs a node id and an input name.`);
    mapping[slot as ComfyWorkflowSlot] = { node, input };
  }
  return mapping;
}

function normalizeWorkflowRecord(value: unknown): ImageProviderWorkflow {
  if (!isRecord(value) || typeof value.sha256 !== 'string' || !SHA256.test(value.sha256) || typeof value.importedAt !== 'string'
    || !Array.isArray(value.slots) || !value.slots.every(slot => (COMFY_WORKFLOW_SLOTS as readonly unknown[]).includes(slot))) {
    fail('The stored workflow record is invalid.');
  }
  const record = value as Record<string, unknown>;
  return {
    sha256: record.sha256 as string,
    mapping: normalizeMapping(record.mapping),
    slots: [...new Set(record.slots as ComfyWorkflowSlot[])],
    importedAt: record.importedAt as string,
  };
}

export function normalizeImageProviderConfig(value: unknown): ImageProviderConfig {
  if (!isRecord(value)) fail('The image service config is invalid.');
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !PROVIDER_ID.test(v.id)) fail('The service id must be 1 to 64 letters, digits, "_" or "-".');
  const kind = IMAGE_PROVIDER_KINDS.find(known => known === v.kind);
  if (!kind) fail('The service type is invalid.');
  const baseUrl = normalizeImageProviderBaseUrl(v.baseUrl);
  const allowRemote = v.allowRemote === true;
  if (kind === 'comfyui' && !allowRemote && !isLoopbackHost(new URL(baseUrl).hostname)) {
    fail('A ComfyUI address outside this machine has to be allowed explicitly.');
  }
  const model = typeof v.model === 'string' ? v.model.trim() : '';
  if (kind !== 'comfyui' && !model) fail('An online service needs a model.');
  if (model) boundedText(model, IMAGE_GENERATION_LIMITS.maxLabel, 'The model');
  const displayName = typeof v.displayName === 'string' && v.displayName.trim() ? v.displayName.trim() : v.id as string;
  boundedText(displayName, IMAGE_GENERATION_LIMITS.maxLabel, 'The display name');
  const defaultNegative = typeof v.defaultNegative === 'string' ? v.defaultNegative.trim() : '';
  boundedText(defaultNegative, IMAGE_GENERATION_LIMITS.maxPromptChars, 'The default negative prompt');
  const apiKey = typeof v.apiKey === 'string' && v.apiKey.trim() ? v.apiKey.trim() : undefined;
  let lastError: ImageProviderLastError | undefined;
  if (isRecord(v.lastError) && typeof v.lastError.at === 'string' && typeof v.lastError.code === 'string' && typeof v.lastError.message === 'string') {
    lastError = { at: v.lastError.at, code: v.lastError.code as ImageGenerationErrorCode, message: v.lastError.message.slice(0, 500) };
  }
  return {
    id: v.id as string,
    kind: kind as ImageProviderKind,
    displayName,
    baseUrl,
    ...(kind !== 'comfyui' ? { model } : {}),
    defaultWidth: integerBetween(v.defaultWidth ?? 768, IMAGE_GENERATION_LIMITS.minSide, IMAGE_GENERATION_LIMITS.maxSide, 'The default width'),
    defaultHeight: integerBetween(v.defaultHeight ?? 1152, IMAGE_GENERATION_LIMITS.minSide, IMAGE_GENERATION_LIMITS.maxSide, 'The default height'),
    ...(defaultNegative ? { defaultNegative } : {}),
    timeoutMs: integerBetween(v.timeoutMs ?? IMAGE_GENERATION_LIMITS.defaultTimeoutMs, IMAGE_GENERATION_LIMITS.minTimeoutMs, IMAGE_GENERATION_LIMITS.maxTimeoutMs, 'The timeout'),
    ...(kind === 'comfyui' && allowRemote ? { allowRemote: true } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(kind === 'comfyui' && v.workflow !== undefined ? { workflow: normalizeWorkflowRecord(v.workflow) } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

export const createEmptyImageProviderConfigState = (): ImageProviderConfigState => ({ providers: [] });

export function upsertImageProviderConfig(state: ImageProviderConfigState, provider: ImageProviderConfig): ImageProviderConfigState {
  const next = normalizeImageProviderConfig(provider);
  return state.providers.some(item => item.id === next.id)
    ? { providers: state.providers.map(item => item.id === next.id ? next : item) }
    : { providers: [...state.providers, next] };
}

export function removeImageProviderConfig(state: ImageProviderConfigState, id: string): ImageProviderConfigState {
  return { providers: state.providers.filter(item => item.id !== id) };
}

/** What the UI may see: no key, only whether one is stored. */
export function redactImageProviderConfig(provider: ImageProviderConfig): ImageProviderConfig {
  const { apiKey, ...rest } = provider;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

export function normalizePortraitImageRequest(value: unknown): PortraitImageRequest {
  if (!isRecord(value)) fail('The image request is invalid.');
  const v = value as Record<string, unknown>;
  const positive = boundedText(v.positive, IMAGE_GENERATION_LIMITS.maxPromptChars, 'The prompt').trim();
  if (!positive) fail('The prompt is empty.');
  const negative = v.negative === undefined ? '' : boundedText(v.negative, IMAGE_GENERATION_LIMITS.maxPromptChars, 'The negative prompt').trim();
  const loraName = v.loraName === undefined ? '' : boundedText(v.loraName, 200, 'The LoRA name').trim();
  return {
    positive,
    ...(negative ? { negative } : {}),
    width: integerBetween(v.width, IMAGE_GENERATION_LIMITS.minSide, IMAGE_GENERATION_LIMITS.maxSide, 'The width'),
    height: integerBetween(v.height, IMAGE_GENERATION_LIMITS.minSide, IMAGE_GENERATION_LIMITS.maxSide, 'The height'),
    ...(v.seed === undefined ? {} : { seed: integerBetween(v.seed, 0, Number.MAX_SAFE_INTEGER, 'The seed') }),
    count: integerBetween(v.count ?? 1, 1, IMAGE_GENERATION_LIMITS.maxCount, 'The image count'),
    ...(loraName ? { loraName } : {}),
  };
}

export interface PortraitPromptParts {
  /** Roster `looks.fixedBooruTags`. */
  characterTags?: string;
  /** Roster `looks.outfitTags`. */
  outfitTags?: string;
  /** Roster `looks.loraTrigger`. */
  loraTrigger?: string;
  /** The portrait's own prompt. */
  prompt: { positive: string; negative?: string; useCharacterTags?: boolean };
  /** The service's default negative prompt. */
  defaultNegative?: string;
}

function tags(...parts: Array<string | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const tag of (part ?? '').split(/[,，\n]/u).map(item => item.trim()).filter(Boolean)) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out.join(', ');
}

/**
 * Builds the prompt for one portrait. Order is fixed: LoRA trigger, character tags, outfit tags,
 * then the portrait's own prompt; repeated tags are kept once. `useCharacterTags: false` leaves
 * the roster tags and trigger out. The portrait's negative prompt comes before the service default.
 */
export function composePortraitPrompt(parts: PortraitPromptParts): { positive: string; negative: string } {
  const withCharacter = parts.prompt.useCharacterTags !== false;
  return {
    positive: tags(...(withCharacter ? [parts.loraTrigger, parts.characterTags, parts.outfitTags] : []), parts.prompt.positive),
    negative: tags(parts.prompt.negative, parts.defaultNegative),
  };
}

const PLACEHOLDER = /\{\{(positive|negative|seed|width|height|batch|lora)\}\}/gu;

function parseWorkflow(text: string): Record<string, { inputs: Record<string, unknown> } & Record<string, unknown>> {
  if (new TextEncoder().encode(text).byteLength > IMAGE_GENERATION_LIMITS.maxWorkflowBytes) {
    throw new ImageGenerationError('workflow', 'The workflow file is larger than 1 MiB.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ImageGenerationError('workflow', 'The workflow is not valid JSON.'); }
  if (!isRecord(parsed) || Object.keys(parsed).length === 0) throw new ImageGenerationError('workflow', 'The workflow has no nodes.');
  // The editor's own save format is a different shape and cannot be queued.
  if (Array.isArray(parsed.nodes) || !Object.values(parsed).every(node => isRecord(node) && typeof node.class_type === 'string' && isRecord(node.inputs))) {
    throw new ImageGenerationError('workflow', 'This is not an API-format workflow. In ComfyUI use "Save (API Format)" / "Export (API)".');
  }
  return parsed as Record<string, { inputs: Record<string, unknown> } & Record<string, unknown>>;
}

function collectPlaceholders(value: unknown, found: Set<ComfyWorkflowSlot>): void {
  if (typeof value === 'string') for (const match of value.matchAll(PLACEHOLDER)) found.add(match[1] as ComfyWorkflowSlot);
  else if (Array.isArray(value)) value.forEach(item => collectPlaceholders(item, found));
  else if (isRecord(value)) Object.values(value).forEach(item => collectPlaceholders(item, found));
}

/**
 * Checks an API-format workflow against its mapping when it is imported. Every mapped slot
 * must point at an existing node input, and the positive prompt must have somewhere to go.
 */
export function inspectComfyWorkflow(text: string, mappingInput: unknown): { mapping: ComfyWorkflowMapping; slots: ComfyWorkflowSlot[] } {
  const workflow = parseWorkflow(text);
  let mapping: ComfyWorkflowMapping;
  try { mapping = normalizeMapping(mappingInput); } catch (error) { throw new ImageGenerationError('workflow', (error as Error).message); }
  const found = new Set<ComfyWorkflowSlot>();
  for (const node of Object.values(workflow)) collectPlaceholders(node.inputs, found);
  for (const [slot, target] of Object.entries(mapping) as Array<[ComfyWorkflowSlot, ComfyWorkflowTarget]>) {
    const node = workflow[target.node];
    if (!node) throw new ImageGenerationError('workflow', `The mapping for ${slot} names node ${target.node}, which the workflow does not have.`);
    if (!Object.hasOwn(node.inputs, target.input)) throw new ImageGenerationError('workflow', `Node ${target.node} has no input named ${target.input} (mapping for ${slot}).`);
    found.add(slot);
  }
  if (!found.has('positive')) {
    throw new ImageGenerationError('workflow', 'The workflow has no place for the prompt: map the positive prompt to a node input, or put {{positive}} in the workflow.');
  }
  return { mapping, slots: COMFY_WORKFLOW_SLOTS.filter(slot => found.has(slot)) };
}

/**
 * Fills a workflow for one request. Only mapped inputs and `{{slot}}` placeholders change;
 * every other node is sent exactly as imported. A string that is nothing but a numeric
 * placeholder becomes a number, so `"{{seed}}"` works where ComfyUI expects an integer.
 */
export function fillComfyWorkflow(text: string, mapping: ComfyWorkflowMapping, request: PortraitImageRequest, seed: number): Record<string, unknown> {
  const { mapping: checked } = inspectComfyWorkflow(text, mapping);
  const workflow = parseWorkflow(text);
  const values: Record<ComfyWorkflowSlot, string | number | undefined> = {
    positive: request.positive,
    negative: request.negative ?? '',
    seed,
    width: request.width,
    height: request.height,
    batch: request.count,
    lora: request.loraName,
  };
  const need = (slot: ComfyWorkflowSlot): string | number => {
    const value = values[slot];
    if (value === undefined) throw new ImageGenerationError('workflow', `The workflow needs a value for ${slot}, and this request has none.`);
    return value;
  };
  const substitute = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const whole = /^\{\{(positive|negative|seed|width|height|batch|lora)\}\}$/u.exec(value);
      if (whole) return need(whole[1] as ComfyWorkflowSlot);
      return value.replace(PLACEHOLDER, (_match, slot: ComfyWorkflowSlot) => String(need(slot)));
    }
    // A two-item [node id, output index] array is a link between nodes; its items are never text.
    if (Array.isArray(value)) return value.map(substitute);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item)]));
    return value;
  };
  for (const node of Object.values(workflow)) node.inputs = substitute(node.inputs) as Record<string, unknown>;
  for (const [slot, target] of Object.entries(checked) as Array<[ComfyWorkflowSlot, ComfyWorkflowTarget]>) {
    // A mapped LoRA input keeps the workflow's own file when the request names none.
    if (slot === 'lora' && values.lora === undefined) continue;
    workflow[target.node]!.inputs[target.input] = need(slot);
  }
  return workflow;
}

/** One line of the image generation log: what was sent where, never what was asked for. */
export interface ImageGenerationLogRecord {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  providerId: string;
  providerKind: ImageProviderKind;
  modelId?: string;
  /** Scheme, host and port only. */
  endpointOrigin: string;
  /** The service runs on this machine. */
  local: boolean;
  requestedCount: number;
  width: number;
  height: number;
  durationMs: number;
  outcome: 'completed' | 'failed' | 'cancelled';
  imageCount: number;
  errorCode?: ImageGenerationErrorCode;
}

const LOG_KEYS = ['schemaVersion', 'id', 'createdAt', 'providerId', 'providerKind', 'modelId', 'endpointOrigin', 'local', 'requestedCount', 'width', 'height', 'durationMs', 'outcome', 'imageCount', 'errorCode'];
const ERROR_CODES: readonly ImageGenerationErrorCode[] = ['unreachable', 'auth', 'timeout', 'content_rejected', 'invalid_response', 'workflow', 'cancelled', 'config'];

/** Rejects anything that is not exactly a log record, so a prompt or key can never ride along. */
export function parseImageGenerationLogRecord(value: unknown): ImageGenerationLogRecord {
  const bad = (): never => { throw new Error('Invalid image generation log record.'); };
  if (!isRecord(value) || Object.keys(value).some(key => !LOG_KEYS.includes(key))) return bad();
  const v = value;
  const count = (item: unknown): boolean => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
  let origin: string;
  try { origin = new URL(String(v.endpointOrigin)).origin; } catch { return bad(); }
  if (v.schemaVersion !== 1 || typeof v.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(v.id)
    || typeof v.createdAt !== 'string' || Number.isNaN(Date.parse(v.createdAt))
    || typeof v.providerId !== 'string' || !PROVIDER_ID.test(v.providerId)
    || !IMAGE_PROVIDER_KINDS.some(kind => kind === v.providerKind)
    || (v.modelId !== undefined && (typeof v.modelId !== 'string' || v.modelId.length > IMAGE_GENERATION_LIMITS.maxLabel))
    || origin !== v.endpointOrigin || typeof v.local !== 'boolean'
    || ![v.requestedCount, v.width, v.height, v.durationMs, v.imageCount].every(count)
    || !['completed', 'failed', 'cancelled'].includes(String(v.outcome))
    || (v.errorCode !== undefined && !ERROR_CODES.some(code => code === v.errorCode))) return bad();
  return structuredClone(v) as unknown as ImageGenerationLogRecord;
}
