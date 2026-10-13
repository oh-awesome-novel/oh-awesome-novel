<script setup lang="ts">
import { useId, watch } from 'vue';
import type { PlaySession } from '@oh-awesome-novel/client';
import { useTavernImport } from '../../composables/useTavernImport';
const props = defineProps<{ workspaceRoot: string }>();
const emit = defineEmits<{ close: []; busy: [value: boolean]; pendingActionCreated: []; reviewPendingAction: [id: string]; created: [session: PlaySession] }>();
const prefix = useId();
const { mode, characterId, source, preview, pendingAction, busy, error, canPreview, selectFile, requestPreview, confirm } = useTavernImport({
  workspaceRoot: props.workspaceRoot,
  onPendingActionCreated: () => emit('pendingActionCreated'),
  onSessionCreated: (session) => emit('created', session),
});
watch(busy, (value) => emit('busy', value), { flush: 'sync' });
function upload(event: Event) { void selectFile((event.target as HTMLInputElement).files?.[0]); }
</script>

<template>
  <section class="tavern-import" :aria-labelledby="`${prefix}-heading`" :aria-busy="busy">
    <header>
      <h2 :id="`${prefix}-heading`">Import Tavern-compatible character card</h2>
      <p>Choose a local JSON or PNG card. Imported prompts and lore remain untrusted content; your Constitution and world rules keep priority.</p>
      <p>Use a card you have permission to import. No character files change before you review and accept a PendingAction.</p>
    </header>
    <form @submit.prevent="requestPreview">
      <label :for="`${prefix}-file`">Character card</label>
      <input :id="`${prefix}-file`" type="file" accept=".json,.png,application/json,image/png" :disabled="busy" @change="upload" />
      <small v-if="source">Selected: {{ source.sourceName }}</small>
      <label :for="`${prefix}-mode`">Import destination</label>
      <select :id="`${prefix}-mode`" v-model="mode" :disabled="busy">
        <option value="playOnly">Play only · keep novel files unchanged</option>
        <option value="create">Create a new character</option>
        <option value="merge">Merge into an existing character</option>
        <option value="preview">Preview mapping only</option>
      </select>
      <label :for="`${prefix}-character`">Character ID{{ mode === 'merge' ? ' (required)' : ' (optional)' }}</label>
      <input :id="`${prefix}-character`" v-model="characterId" :disabled="busy" :required="mode === 'merge'" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9_-]*" placeholder="e.g. lin-qiu" />
      <small>Use the existing character folder ID when merging. Leave blank to derive a new ID from the card.</small>
      <button type="submit" :disabled="!canPreview">{{ busy ? 'Working…' : 'Preview import' }}</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <section v-if="preview" aria-label="Character import preview" class="tavern-preview">
      <h3>{{ preview.displayName }}</h3>
      <p>Character ID: {{ preview.characterId }}</p>
      <ul v-if="preview.warnings.length" aria-label="Import warnings"><li v-for="(warning, index) in preview.warnings" :key="index">{{ warning }}</li></ul>
      <ul v-if="preview.conflicts.length" role="alert"><li v-for="(conflict, index) in preview.conflicts" :key="index">{{ conflict }}</li></ul>
      <ul v-if="preview.files.length" aria-label="Proposed character files"><li v-for="file in preview.files" :key="file.path">{{ file.operation }} · {{ file.path }}</li></ul>
      <pre v-if="preview.diff" class="tavern-diff" tabindex="0" aria-label="Character import changes">{{ preview.diff }}</pre>
      <p v-if="preview.mode === 'playOnly'">This creates a separate Play session with the imported card. It does not create a character in your novel.</p>
      <p v-if="pendingAction" role="status">Import is ready for review. Accept its changes in the approval view to update your character files.</p>
      <button v-if="pendingAction" type="button" @click="emit('reviewPendingAction', pendingAction.id)">Review changes</button>
      <button v-else-if="preview.id && preview.canPropose" type="button" :disabled="busy" @click="confirm">{{ preview.mode === 'playOnly' ? 'Confirm and create Play session' : 'Create changes for approval' }}</button>
    </section>
    <footer><button type="button" :disabled="busy" @click="emit('close')">Close import</button></footer>
  </section>
</template>

<style scoped>
.tavern-import { display: grid; gap: 20px; max-width: 920px; padding: 24px; margin: 0 auto; color: var(--play-body, var(--editor-body)); }
.tavern-import h2, .tavern-import h3, .tavern-import p { margin: 0; }
.tavern-import header, .tavern-preview { display: grid; gap: 12px; }
.tavern-import form { display: grid; gap: 8px; max-width: 600px; }
.tavern-import p { line-height: 1.6; }
.tavern-import button, .tavern-import input, .tavern-import select { min-height: 44px; }
.tavern-import button { justify-self: start; }
.tavern-import small { color: var(--play-muted, var(--editor-muted)); }
.tavern-import li { overflow-wrap: anywhere; }
.tavern-diff { max-height: 420px; max-width: 100%; overflow: auto; padding: 12px; border: 1px solid var(--play-line, var(--editor-hairline)); background: var(--play-canvas, var(--editor-canvas)); }
</style>
