<script setup lang="ts">
import { useId } from 'vue';

import type { PlaySessionPurpose } from '../../../composables/useWorkspaceApi';
import type {
  PlayGuidedIdentityDraft,
  PlayGuidedStartErrors,
} from '../../../composables/usePlayGuidedStart';

const { purpose, draft, errors, disabled } = defineProps<{
  purpose: PlaySessionPurpose;
  draft: Readonly<PlayGuidedIdentityDraft>;
  errors: Readonly<PlayGuidedStartErrors>;
  disabled: boolean;
}>();

const emit = defineEmits<{
  update: [patch: Partial<PlayGuidedIdentityDraft>];
  back: [];
  next: [];
  cancel: [];
}>();

const prefix = `${useId()}-guided-identity`;

function update(field: keyof PlayGuidedIdentityDraft, event: Event): void {
  emit('update', {
    [field]: (event.target as HTMLInputElement | HTMLTextAreaElement).value,
  });
}
</script>

<template>
  <form class="guided-identity" :aria-labelledby="`${prefix}-heading`" @submit.prevent="emit('next')">
    <header>
      <span>第 3 / 5 步</span>
      <h2 :id="`${prefix}-heading`">身份</h2>
      <p v-if="purpose === 'immersiveJourney'">设定以什么身份进入这个世界。</p>
      <p v-else>写下导演想通过这次试演检验什么。</p>
    </header>

    <label v-if="purpose === 'immersiveJourney'">
      <span>参与者身份</span>
      <textarea
        name="guided-player-persona"
        rows="4"
        :value="draft.persona"
        :disabled="disabled"
        :aria-invalid="Boolean(errors.persona)"
        aria-required="true"
        placeholder="我在这里是谁，合理地知道些什么？"
        @input="update('persona', $event)"
      ></textarea>
      <small v-if="errors.persona" class="field-error">{{ errors.persona }}</small>
    </label>

    <label v-else>
      <span>试演目的</span>
      <textarea
        name="guided-director-purpose"
        rows="4"
        :value="draft.directorPurpose"
        :disabled="disabled"
        :aria-invalid="Boolean(errors.directorPurpose)"
        aria-required="true"
        placeholder="这次要检验哪种角色行为或场景张力？"
        @input="update('directorPurpose', $event)"
      ></textarea>
      <small v-if="errors.directorPurpose" class="field-error">{{ errors.directorPurpose }}</small>
    </label>

    <aside>
      <strong>{{ purpose === 'immersiveJourney' ? '参与者视角' : '导演视角' }}</strong>
      <span>身份只改变能看到什么，不会产生第二套世界事实。</span>
    </aside>

    <footer>
      <button type="button" :disabled="disabled" @click="emit('cancel')">取消</button>
      <div>
        <button type="button" :disabled="disabled" @click="emit('back')">返回入场</button>
        <button class="primary" type="submit" :disabled="disabled">下一步：人物</button>
      </div>
    </footer>
  </form>
</template>

<style scoped>
.guided-identity,
.guided-identity > header,
.guided-identity label {
  display: grid;
  gap: 12px;
}

.guided-identity > header,
.guided-identity label {
  gap: 5px;
}

h2,
p {
  margin: 0;
}

h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 17px;
}

header > span,
header p,
label > span,
aside span {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

textarea,
button {
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
  font: inherit;
}

textarea {
  padding: 8px;
}

aside {
  display: grid;
  gap: 3px;
  padding: 10px;
  border-left: 2px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
}

.field-error {
  color: var(--play-danger, var(--editor-danger));
  font-size: 11px;
}

footer,
footer > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

button {
  min-height: 34px;
  padding: 6px 11px;
}

.primary {
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

button:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--play-focus, var(--editor-focus));
  outline-offset: 2px;
}
</style>
