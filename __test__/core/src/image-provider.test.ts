import { describe, expect, it } from 'vite-plus/test';
import {
  ImageGenerationError, composePortraitPrompt, fillComfyWorkflow, inspectComfyWorkflow, isLoopbackHost,
  normalizeImageProviderConfig, normalizePortraitImageRequest, parseImageGenerationLogRecord, redactImageProviderConfig,
  removeImageProviderConfig, upsertImageProviderConfig,
} from '@oh-awesome-novel/core';

const workflow = JSON.stringify({
  3: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: '{{batch}}' } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece, {{positive}}', clip: ['4', 1] } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: 'old negative', clip: ['4', 1] } },
  10: { class_type: 'LoraLoader', inputs: { lora_name: 'base.safetensors', strength_model: 0.8 } },
});
const mapping = { negative: { node: '7', input: 'text' }, seed: { node: '3', input: 'seed' }, width: { node: '5', input: 'width' }, height: { node: '5', input: 'height' }, lora: { node: '10', input: 'lora_name' } };
const request = { positive: 'silver hair', negative: 'blurry', width: 768, height: 1152, count: 2 };
const code = (work: () => unknown) => { try { work(); } catch (error) { return (error as ImageGenerationError).code; } return undefined; };

describe('image provider config', () => {
  it('normalises a service, keeps its key out of what the UI sees, and replaces by id', () => {
    const comfy = normalizeImageProviderConfig({ id: 'local', kind: 'comfyui', baseUrl: 'http://127.0.0.1:8188/', model: 'ignored' });
    expect(comfy).toEqual({ id: 'local', kind: 'comfyui', displayName: 'local', baseUrl: 'http://127.0.0.1:8188', defaultWidth: 768, defaultHeight: 1152, timeoutMs: 120_000 });
    const online = normalizeImageProviderConfig({ id: 'cloud', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: ' sk-secret ', defaultNegative: ' blurry ' });
    expect(online.apiKey).toBe('sk-secret');
    const redacted = redactImageProviderConfig(online);
    expect(redacted).toMatchObject({ hasApiKey: true, model: 'gpt-image-1', defaultNegative: 'blurry' });
    expect(JSON.stringify(redacted)).not.toContain('sk-secret');
    let state = upsertImageProviderConfig({ providers: [] }, comfy);
    state = upsertImageProviderConfig(state, online);
    state = upsertImageProviderConfig(state, { ...comfy, displayName: '书房的 ComfyUI' });
    expect(state.providers.map(item => item.displayName)).toEqual(['书房的 ComfyUI', 'cloud']);
    expect(removeImageProviderConfig(state, 'local').providers.map(item => item.id)).toEqual(['cloud']);
  });

  it('refuses a ComfyUI address outside this machine unless it is allowed, and other unsafe values', () => {
    expect(code(() => normalizeImageProviderConfig({ id: 'lan', kind: 'comfyui', baseUrl: 'http://192.168.1.20:8188' }))).toBe('config');
    expect(normalizeImageProviderConfig({ id: 'lan', kind: 'comfyui', baseUrl: 'http://192.168.1.20:8188', allowRemote: true }).allowRemote).toBe(true);
    for (const host of ['localhost', '127.0.0.1', '127.8.9.1', '[::1]', 'comfy.localhost']) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ['127.0.0.1.example.com', '10.0.0.1', 'example.com', '0.0.0.0']) expect(isLoopbackHost(host)).toBe(false);
    for (const bad of [
      { id: '../x', kind: 'comfyui', baseUrl: 'http://127.0.0.1:8188' },
      { id: 'a', kind: 'midjourney', baseUrl: 'http://127.0.0.1:8188' },
      { id: 'a', kind: 'comfyui', baseUrl: 'file:///etc/passwd' },
      { id: 'a', kind: 'comfyui', baseUrl: 'http://user:pass@127.0.0.1:8188' },
      { id: 'a', kind: 'openai', baseUrl: 'https://api.openai.com/v1' },
      { id: 'a', kind: 'comfyui', baseUrl: 'http://127.0.0.1:8188', timeoutMs: 10 },
      { id: 'a', kind: 'comfyui', baseUrl: 'http://127.0.0.1:8188', defaultWidth: 99999 },
    ]) expect(code(() => normalizeImageProviderConfig(bad))).toBe('config');
  });

  it('bounds a request', () => {
    expect(normalizePortraitImageRequest({ ...request, seed: 7 })).toEqual({ ...request, seed: 7 });
    expect(normalizePortraitImageRequest({ positive: ' a ', width: 64, height: 64 }).count).toBe(1);
    for (const bad of [{ ...request, count: 5 }, { ...request, width: 10 }, { ...request, positive: '  ' }, { ...request, seed: -1 }, { ...request, positive: 'x'.repeat(4001) }]) {
      expect(code(() => normalizePortraitImageRequest(bad))).toBe('config');
    }
  });
});

describe('portrait prompt', () => {
  it('orders trigger, character tags, outfit tags and the portrait prompt, keeping each tag once', () => {
    const parts = { characterTags: 'silver hair, red eyes', outfitTags: 'white dress，Silver Hair', loraTrigger: 'nian_v2', defaultNegative: 'lowres, blurry' };
    expect(composePortraitPrompt({ ...parts, prompt: { positive: 'angry, red eyes, looking at viewer', negative: 'blurry\nextra fingers' } })).toEqual({
      positive: 'nian_v2, silver hair, red eyes, white dress, angry, looking at viewer',
      negative: 'blurry, extra fingers, lowres',
    });
    // The same input always gives the same text.
    expect(composePortraitPrompt({ ...parts, prompt: { positive: 'angry' } })).toEqual(composePortraitPrompt({ ...parts, prompt: { positive: 'angry' } }));
    expect(composePortraitPrompt({ ...parts, prompt: { positive: 'full body', useCharacterTags: false } })).toEqual({ positive: 'full body', negative: 'lowres, blurry' });
    expect(composePortraitPrompt({ prompt: { positive: 'smile' } })).toEqual({ positive: 'smile', negative: '' });
  });
});

describe('ComfyUI workflow', () => {
  it('reports which slots a workflow fills and fills only those', () => {
    expect(inspectComfyWorkflow(workflow, mapping).slots).toEqual(['positive', 'negative', 'seed', 'width', 'height', 'batch', 'lora']);
    const filled = fillComfyWorkflow(workflow, mapping, request, 42) as Record<string, { inputs: Record<string, unknown> }>;
    expect(filled['6']!.inputs.text).toBe('masterpiece, silver hair');
    expect(filled['7']!.inputs.text).toBe('blurry');
    expect(filled['3']!.inputs).toEqual({ seed: 42, steps: 20, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] });
    // A whole-value numeric placeholder becomes a number.
    expect(filled['5']!.inputs).toEqual({ width: 768, height: 1152, batch_size: 2 });
    // No LoRA in the request: the workflow's own file stays.
    expect(filled['10']!.inputs).toEqual({ lora_name: 'base.safetensors', strength_model: 0.8 });
    expect((fillComfyWorkflow(workflow, mapping, { ...request, loraName: 'nian.safetensors' }, 1) as typeof filled)['10']!.inputs.lora_name).toBe('nian.safetensors');
    // The imported text is not changed by filling it.
    expect(JSON.parse(workflow)['6'].inputs.text).toBe('masterpiece, {{positive}}');
  });

  it('rejects a workflow with nowhere for the prompt, a bad mapping, or the wrong format', () => {
    const noPrompt = JSON.stringify({ 6: { class_type: 'CLIPTextEncode', inputs: { text: 'fixed' } } });
    expect(code(() => inspectComfyWorkflow(noPrompt, {}))).toBe('workflow');
    expect(inspectComfyWorkflow(noPrompt, { positive: { node: '6', input: 'text' } }).slots).toEqual(['positive']);
    expect(code(() => inspectComfyWorkflow(workflow, { seed: { node: '99', input: 'seed' } }))).toBe('workflow');
    expect(code(() => inspectComfyWorkflow(workflow, { seed: { node: '3', input: 'noise' } }))).toBe('workflow');
    expect(code(() => inspectComfyWorkflow(workflow, { style: { node: '3', input: 'seed' } }))).toBe('workflow');
    expect(code(() => inspectComfyWorkflow('{"nodes":[],"links":[]}', {}))).toBe('workflow');
    expect(code(() => inspectComfyWorkflow('not json', {}))).toBe('workflow');
    // A {{lora}} placeholder needs a LoRA in the request.
    const needsLora = JSON.stringify({ 6: { class_type: 'X', inputs: { text: '{{positive}}', lora: '{{lora}}' } } });
    expect(code(() => fillComfyWorkflow(needsLora, {}, request, 1))).toBe('workflow');
  });
});

describe('image generation log record', () => {
  const entry = { schemaVersion: 1, id: 'a-1', createdAt: '2026-11-13T00:00:00.000Z', providerId: 'local', providerKind: 'comfyui', endpointOrigin: 'http://127.0.0.1:8188', local: true, requestedCount: 2, width: 768, height: 1152, durationMs: 1200, outcome: 'completed', imageCount: 2 };
  it('accepts exactly the content-free fields', () => {
    expect(parseImageGenerationLogRecord(entry)).toEqual(entry);
    expect(parseImageGenerationLogRecord({ ...entry, outcome: 'failed', imageCount: 0, errorCode: 'timeout', modelId: 'gpt-image-1' }).errorCode).toBe('timeout');
    for (const bad of [
      { ...entry, prompt: 'silver hair' },
      { ...entry, apiKey: 'sk-secret' },
      { ...entry, endpointOrigin: 'http://127.0.0.1:8188/view?token=1' },
      { ...entry, outcome: 'ok' },
      { ...entry, errorCode: 'boom' },
    ]) expect(() => parseImageGenerationLogRecord(bad)).toThrow('Invalid image generation log record');
  });
});
