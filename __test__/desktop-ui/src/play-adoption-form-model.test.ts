import { describe, expect, it } from 'vite-plus/test';

import {
  normalizePlayAdoptionBusinessTarget,
  suggestPlayAdoptionTargets,
} from '@oh-awesome-novel/core';

import {
  formFromPayload,
  payloadFromForm,
} from '../../../apps/desktop-ui/src/composables/playAdoptionForm';
import type {
  ChapterDraftForm,
  ForeshadowForm,
  StateForm,
  TimelineForm,
} from '../../../apps/desktop-ui/src/composables/playAdoptionForm';

const suggestions = suggestPlayAdoptionTargets({
  seed: { kind: 'event', eventId: 'event-1' },
  summary: '公共大门被锁上了。',
  evidence: '选中分支里有一条可见的关门事件。',
  visibility: 'playerVisible',
  evidenceFingerprint: 'a'.repeat(64),
});
const defaults = Object.fromEntries(suggestions.map((item) => [item.target, item.defaultPayload]));

describe('Play adoption typed forms', () => {
  it('round-trips every server default payload unchanged and passes backend validation', () => {
    for (const suggestion of suggestions) {
      const form = formFromPayload(suggestion.target, suggestion.defaultPayload);
      const built = payloadFromForm(form, suggestion.defaultPayload);
      expect(built.errors).toEqual({});
      expect(built.payload).toEqual(suggestion.defaultPayload);
      expect(() => normalizePlayAdoptionBusinessTarget({ target: suggestion.target, payload: built.payload! })).not.toThrow();
    }
  });

  it('fills a chapter draft without JSON', () => {
    const form = formFromPayload('chapterDraft', defaults.chapterDraft!) as ChapterDraftForm;
    form.title = '第三章 雨夜';
    form.content = '  她把伞收了起来。  ';
    const built = payloadFromForm(form, defaults.chapterDraft!);
    expect(built.payload).toEqual({ chapterId: '0001/0001', mode: 'replace', title: '第三章 雨夜', content: '她把伞收了起来。' });
    expect(normalizePlayAdoptionBusinessTarget({ target: 'chapterDraft', payload: built.payload! })).toMatchObject({
      targetFile: 'chapters/0001/0001.md',
      content: '# 第三章 雨夜\n\n她把伞收了起来。\n',
    });
    form.content = ' ';
    expect(payloadFromForm(form, defaults.chapterDraft!)).toEqual({ errors: { content: '请填写正文。' } });
  });

  it('edits state as add/remove rows and keeps non-string values typed', () => {
    const form = formFromPayload('state', defaults.state!) as StateForm;
    expect(form.rows.map((row) => row.key)).toEqual(['summary', 'evidenceFingerprint']);
    form.rows.push({ key: 'locked', value: 'true', json: true });
    form.rows.push({ key: '位置', value: '东门', json: false });
    form.rows = form.rows.filter((row) => row.key !== 'evidenceFingerprint');
    const built = payloadFromForm(form, defaults.state!);
    expect(built.payload?.value).toEqual({ summary: '公共大门被锁上了。', locked: true, 位置: '东门' });
    expect(() => normalizePlayAdoptionBusinessTarget({ target: 'state', payload: built.payload! })).not.toThrow();

    form.rows.push({ key: 'bad key', value: 'x', json: false }, { key: 'n', value: '{oops', json: true });
    form.file = '../escape.yaml';
    form.path = 'a..b';
    const invalid = payloadFromForm(form, defaults.state!);
    expect(invalid.payload).toBeUndefined();
    expect(Object.keys(invalid.errors).sort()).toEqual(['file', 'path', 'rows.3.key', 'rows.4.value'].sort());
  });

  it('fills timeline time, event, participants and place', () => {
    const form = formFromPayload('timeline', defaults.timeline!) as TimelineForm;
    form.date = '七月十七日夜';
    form.participants = '米拉、任野, 守门人';
    form.location = '旧钟楼';
    const built = payloadFromForm(form, defaults.timeline!);
    expect(built.payload).toMatchObject({
      file: 'events.yaml',
      path: 'events',
      event: {
        id: (defaults.timeline!.event as { id: string }).id,
        summary: '公共大门被锁上了。',
        date: '七月十七日夜',
        participants: ['米拉', '任野', '守门人'],
        location: '旧钟楼',
        source: 'play',
        evidenceFingerprint: 'a'.repeat(64),
      },
    });
    expect(() => normalizePlayAdoptionBusinessTarget({ target: 'timeline', payload: built.payload! })).not.toThrow();
    form.summary = '';
    expect(payloadFromForm(form, defaults.timeline!).errors).toEqual({ summary: '请填写事件。' });
  });

  it('fills foreshadow description, plant location and expected payoff', () => {
    const form = formFromPayload('foreshadow', defaults.foreshadow!) as ForeshadowForm;
    form.firstChapter = '0001/0003';
    form.expectedResolution = '第十三下钟声响起时';
    const built = payloadFromForm(form, defaults.foreshadow!);
    expect(built.payload?.item).toMatchObject({
      summary: '公共大门被锁上了。',
      status: 'active',
      firstChapter: '0001/0003',
      expectedResolution: '第十三下钟声响起时',
    });
    expect(() => normalizePlayAdoptionBusinessTarget({ target: 'foreshadow', payload: built.payload! })).not.toThrow();
    form.firstChapter = '';
    expect(payloadFromForm(form, defaults.foreshadow!).payload?.item).not.toHaveProperty('firstChapter');
  });
});
