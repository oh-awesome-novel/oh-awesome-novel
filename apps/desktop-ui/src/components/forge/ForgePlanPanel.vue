<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ plan: Record<string, unknown>; busy: boolean }>();
const emit = defineEmits<{ save: [plan: Record<string, unknown>]; dirty: [value: boolean] }>();

const edited = ref<any>(JSON.parse(JSON.stringify(props.plan)));
const dirty = ref(false);

watch(() => props.plan, (value) => {
  edited.value = JSON.parse(JSON.stringify(value));
  dirty.value = false;
  emit('dirty', false);
}, { deep: true });

function markDirty(): void {
  dirty.value = true;
  emit('dirty', true);
}

function save(): void {
  emit('save', JSON.parse(JSON.stringify(edited.value)));
  dirty.value = false;
  emit('dirty', false);
}

// Facet helpers
const FACET_LABELS: Record<string, string> = {
  normal: '常态面 (日常状态)',
  pressure: '压力面 (危机/重压)',
  private: '私密面 (独处/卸下防备)',
};

function addDialogueLine(facet: any): void {
  if (!facet.dialogue) facet.dialogue = [];
  facet.dialogue.push('');
  markDirty();
}

function removeDialogueLine(facet: any, index: number | string): void {
  facet.dialogue.splice(Number(index), 1);
  markDirty();
}

// Clarifications helpers
function addClarification(character: any): void {
  if (!character.clarifications) character.clarifications = [];
  character.clarifications.push({ trait: '', meaning: '', when: '', not: '' });
  markDirty();
}

function removeClarification(character: any, index: number | string): void {
  character.clarifications.splice(Number(index), 1);
  markDirty();
}

// Resources (T04) helpers
function addResource(character: any): void {
  if (!character.resources) character.resources = [];
  character.resources.push({ name: '', initial: '', cost: '', settlement: '' });
  markDirty();
}

function removeResource(character: any, index: number | string): void {
  character.resources.splice(Number(index), 1);
  markDirty();
}

// World items helpers
function addStringItem(list: string[]): void {
  list.push('');
  markDirty();
}

function removeStringItem(list: string[], index: number | string): void {
  list.splice(Number(index), 1);
  markDirty();
}

// Places helpers
function addPlace(): void {
  if (!edited.value.places) edited.value.places = [];
  const id = `place_${Date.now() % 10000}`;
  edited.value.places.push({ id, name: '新地点', appearance: '', atmosphere: '', characters: [], events: [''] });
  markDirty();
}

function removePlace(index: number | string): void {
  edited.value.places.splice(Number(index), 1);
  markDirty();
}
</script>

<template>
  <section aria-label="方案审查" class="forge-plan-panel">
    <div class="panel-header">
      <div>
        <h3>定方案 · 文学蓝图</h3>
        <p class="subtitle">结构化审查并调整角色的调色盘、三面性台词、欲望两难代价与世界规则。</p>
      </div>
      <div class="header-actions">
        <button type="button" class="primary-button" :disabled="busy || !dirty" @click="save">
          保存方案修改
        </button>
      </div>
    </div>
    <p v-if="dirty" class="dirty-notice" role="status">方案有未保存的修改，请先保存再撰写。</p>

    <!-- General Settings -->
    <fieldset class="section-card" :disabled="busy">
      <legend>设定总览与开场</legend>
      <div class="form-row">
        <label>
          <span>作品/设定标题</span>
          <input v-model="edited.title" type="text" @input="markDirty" />
        </label>
      </div>
      <div class="form-row">
        <label>
          <span>开场白构思（前三行呈现异常、悬念与动作出场）</span>
          <textarea v-model="edited.opening" rows="3" @input="markDirty" />
        </label>
      </div>
    </fieldset>

    <!-- Characters Section -->
    <div v-for="(char, charIndex) in edited.characters" :key="char.id || charIndex" class="character-card">
      <header class="card-header">
        <h4>角色：{{ char.name }} <span class="id-slug">({{ char.id }})</span></h4>
      </header>

      <!-- Profile & Palette -->
      <fieldset class="inner-card" :disabled="busy">
        <legend>档案与调色盘</legend>
        <div class="grid-2">
          <label>
            <span>名称</span>
            <input v-model="char.name" type="text" @input="markDirty" />
          </label>
          <label>
            <span>别名（逗号分隔）</span>
            <input
              :value="(char.aliases ?? []).join('、')"
              type="text"
              @change="char.aliases = ($event.target as HTMLInputElement).value.split(/[、,，]/).map(s => s.trim()).filter(Boolean); markDirty();"
            />
          </label>
        </div>
        <div class="form-row">
          <label>
            <span>底色 (Base)</span>
            <textarea v-model="char.palette.base" rows="2" placeholder="角色的基准气质与视觉/神态底色" @input="markDirty" />
          </label>
        </div>
        <div class="tones-grid">
          <div class="tone-col">
            <h5>主色调 (Main Tones)</h5>
            <div v-for="(tone, tIdx) in char.palette.mainTones" :key="tIdx" class="tone-box">
              <input v-model="tone.name" type="text" placeholder="主色调特质名" @input="markDirty" />
              <div v-for="(_, bIdx) in tone.behaviors" :key="bIdx" class="behavior-row">
                <input v-model="tone.behaviors[bIdx]" type="text" placeholder="具体场景行为" @input="markDirty" />
              </div>
            </div>
          </div>
          <div class="tone-col">
            <h5>点缀 (Accents)</h5>
            <div v-for="(accent, aIdx) in char.palette.accents" :key="aIdx" class="tone-box">
              <input v-model="accent.name" type="text" placeholder="点缀特质名" @input="markDirty" />
              <div v-for="(_, bIdx) in accent.behaviors" :key="bIdx" class="behavior-row">
                <input v-model="accent.behaviors[bIdx]" type="text" placeholder="反差点缀行为" @input="markDirty" />
              </div>
            </div>
          </div>
        </div>
      </fieldset>

      <!-- Three Facets with Bubble Dialogue -->
      <fieldset class="inner-card" :disabled="busy">
        <legend>三面性与纯台词</legend>
        <div class="facets-grid">
          <div v-for="facet in char.facets" :key="facet.kind" class="facet-box">
            <span class="facet-kind-badge">{{ FACET_LABELS[facet.kind] ?? facet.kind }}</span>
            <label>
              <span class="sublabel">触发条件</span>
              <input v-model="facet.trigger" type="text" @input="markDirty" />
            </label>
            <label>
              <span class="sublabel">身心状态</span>
              <input v-model="facet.state" type="text" @input="markDirty" />
            </label>
            <label>
              <span class="sublabel">习惯动作</span>
              <input v-model="facet.habitualAction" type="text" @input="markDirty" />
            </label>

            <!-- Bubble Dialogue List -->
            <div class="dialogue-bubbles">
              <span class="sublabel">纯台词（{{ facet.dialogue?.length ?? 0 }} 句）</span>
              <div
                v-for="(_, lineIdx) in facet.dialogue"
                :key="lineIdx"
                class="bubble-row"
              >
                <div class="bubble-icon">💬</div>
                <input
                  v-model="facet.dialogue[lineIdx]"
                  type="text"
                  class="bubble-input"
                  placeholder="一句纯台词..."
                  @input="markDirty"
                />
                <button
                  type="button"
                  class="line-del-btn"
                  title="删除此句"
                  @click="removeDialogueLine(facet, lineIdx)"
                >
                  ×
                </button>
              </div>
              <button type="button" class="add-line-btn" @click="addDialogueLine(facet)">
                + 添加一句台词
              </button>
            </div>
          </div>
        </div>
      </fieldset>

      <!-- Clarifications -->
      <fieldset class="inner-card" :disabled="busy">
        <legend>特质边界与反刻板印象</legend>
        <div
          v-for="(clar, cIdx) in char.clarifications"
          :key="cIdx"
          class="clarification-row"
        >
          <div class="clar-fields">
            <input v-model="clar.trait" type="text" placeholder="特质名" @input="markDirty" />
            <input v-model="clar.meaning" type="text" placeholder="真正含义" @input="markDirty" />
            <input v-model="clar.when" type="text" placeholder="何时出现" @input="markDirty" />
            <input v-model="clar.not" type="text" placeholder="绝不是什么" @input="markDirty" />
          </div>
          <button type="button" class="row-del-btn" title="删除" @click="removeClarification(char, cIdx)">
            ×
          </button>
        </div>
        <button type="button" class="secondary-btn" @click="addClarification(char)">
          + 添加特质边界
        </button>
      </fieldset>

      <!-- Dynamics: T01 / T03 / T04 -->
      <fieldset class="inner-card" :disabled="busy">
        <legend>人物动力学 (T01 即时欲望 / T03 两难抉择 / T04 资源账本)</legend>
        <div class="dynamics-grid">
          <!-- T01 -->
          <div class="dynamics-col">
            <h5>即时欲望 (T01)</h5>
            <label>
              <span class="sublabel">眼前目标</span>
              <input v-model="char.desire.goal" type="text" @input="markDirty" />
            </label>
            <label>
              <span class="sublabel">阻力</span>
              <input v-model="char.desire.obstacle" type="text" @input="markDirty" />
            </label>
            <label>
              <span class="sublabel">代价</span>
              <input v-model="char.desire.cost" type="text" @input="markDirty" />
            </label>
          </div>

          <!-- T03 -->
          <div class="dynamics-col">
            <h5>主动抉择 (T03)</h5>
            <label>
              <span class="sublabel">两难困境</span>
              <input v-model="char.choice.dilemma" type="text" @input="markDirty" />
            </label>
            <label>
              <span class="sublabel">决断</span>
              <input v-model="char.choice.decision" type="text" @input="markDirty" />
            </label>
            <label>
              <span class="sublabel">牺牲</span>
              <input v-model="char.choice.sacrifice" type="text" @input="markDirty" />
            </label>
            <label>
              <span class="sublabel">后果</span>
              <input v-model="char.choice.consequence" type="text" @input="markDirty" />
            </label>
          </div>

          <!-- T04 -->
          <div class="dynamics-col">
            <h5>资源账本 (T04)</h5>
            <div v-for="(res, rIdx) in char.resources" :key="rIdx" class="resource-box">
              <div class="resource-header">
                <input v-model="res.name" type="text" placeholder="资源名称" @input="markDirty" />
                <button type="button" class="line-del-btn" @click="removeResource(char, rIdx)">×</button>
              </div>
              <input v-model="res.initial" type="text" placeholder="初态 (如 三次机会)" @input="markDirty" />
              <input v-model="res.cost" type="text" placeholder="消耗方式" @input="markDirty" />
              <input v-model="res.settlement" type="text" placeholder="兑现条件" @input="markDirty" />
            </div>
            <button type="button" class="secondary-btn" @click="addResource(char)">
              + 添加有限资源
            </button>
          </div>
        </div>
      </fieldset>
    </div>

    <!-- World & Places -->
    <fieldset class="section-card" :disabled="busy">
      <legend>世界框架与规则</legend>
      <div class="grid-2">
        <label>
          <span>世界类型</span>
          <select v-model="edited.world.kind" @change="markDirty">
            <option value="fictional">虚构架空 (Fictional)</option>
            <option value="real">现实向 (Real)</option>
          </select>
        </label>
        <label>
          <span>世界前提</span>
          <input v-model="edited.world.premise" type="text" @input="markDirty" />
        </label>
      </div>

      <div class="world-lists-grid">
        <div class="world-list-col">
          <h5>与常识不同的规则</h5>
          <div v-for="(_, rIdx) in edited.world.rules" :key="rIdx" class="list-item-row">
            <input v-model="edited.world.rules[rIdx]" type="text" @input="markDirty" />
            <button type="button" class="line-del-btn" @click="removeStringItem(edited.world.rules, rIdx)">×</button>
          </div>
          <button type="button" class="secondary-btn" @click="addStringItem(edited.world.rules)">+ 添加规则</button>
        </div>
        <div class="world-list-col">
          <h5>主要势力</h5>
          <div v-for="(_, fIdx) in edited.world.factions" :key="fIdx" class="list-item-row">
            <input v-model="edited.world.factions[fIdx]" type="text" @input="markDirty" />
            <button type="button" class="line-del-btn" @click="removeStringItem(edited.world.factions, fIdx)">×</button>
          </div>
          <button type="button" class="secondary-btn" @click="addStringItem(edited.world.factions)">+ 添加势力</button>
        </div>
        <div class="world-list-col">
          <h5>历史往事背景</h5>
          <div v-for="(_, hIdx) in edited.world.history" :key="hIdx" class="list-item-row">
            <input v-model="edited.world.history[hIdx]" type="text" @input="markDirty" />
            <button type="button" class="line-del-btn" @click="removeStringItem(edited.world.history, hIdx)">×</button>
          </div>
          <button type="button" class="secondary-btn" @click="addStringItem(edited.world.history)">+ 添加历史</button>
        </div>
      </div>
    </fieldset>

    <!-- Places Section -->
    <fieldset class="section-card" :disabled="busy">
      <legend>舞台地点</legend>
      <div v-for="(place, pIdx) in edited.places" :key="place.id || pIdx" class="place-box">
        <div class="place-header">
          <strong>{{ place.name }} ({{ place.id }})</strong>
          <button type="button" class="line-del-btn" title="删除地点" @click="removePlace(pIdx)">×</button>
        </div>
        <div class="grid-2">
          <label>
            <span class="sublabel">地点名称</span>
            <input v-model="place.name" type="text" @input="markDirty" />
          </label>
          <label>
            <span class="sublabel">地点标识 (id)</span>
            <input v-model="place.id" type="text" @input="markDirty" />
          </label>
        </div>
        <div class="grid-2">
          <label>
            <span class="sublabel">样子与外观</span>
            <input v-model="place.appearance" type="text" @input="markDirty" />
          </label>
          <label>
            <span class="sublabel">氛围</span>
            <input v-model="place.atmosphere" type="text" @input="markDirty" />
          </label>
        </div>
      </div>
      <button type="button" class="secondary-btn" @click="addPlace">+ 添加地点</button>
    </fieldset>

    <div class="footer-actions">
      <button type="button" class="primary-button" :disabled="busy || !dirty" @click="save">
        保存方案修改
      </button>
    </div>
  </section>
</template>

<style scoped>
.forge-plan-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 16px 0;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.subtitle {
  color: var(--muted-text-color, #666);
  margin: 4px 0 0;
  font-size: 0.9em;
}
.dirty-notice {
  color: #b35900;
  background: rgba(255, 170, 0, 0.1);
  padding: 8px 12px;
  border-radius: 6px;
  margin: 0;
}
.section-card,
.character-card {
  border: 1px solid var(--border-color, #ddd);
  border-radius: 12px;
  padding: 16px;
  background: var(--card-bg, #fafafa);
}
.inner-card {
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
  background: var(--surface-color, #fff);
}
.card-header h4 {
  margin: 0 0 12px;
}
.id-slug {
  font-family: monospace;
  font-size: 0.85em;
  color: #888;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.form-row {
  margin: 8px 0;
}
label {
  display: block;
}
label span {
  display: block;
  font-size: 0.85em;
  font-weight: 500;
  margin-bottom: 4px;
}
.sublabel {
  font-size: 0.8em;
  color: #666;
}
input[type='text'],
textarea,
select {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
  font: inherit;
}
.tones-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 8px;
}
.tone-box {
  background: #f5f5f5;
  padding: 8px;
  border-radius: 6px;
  margin-bottom: 8px;
}
.behavior-row {
  margin-top: 4px;
}
.facets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.facet-box {
  border: 1px solid var(--border-color, #e2e2e2);
  border-radius: 8px;
  padding: 10px;
  background: #fafafa;
}
.facet-kind-badge {
  display: inline-block;
  font-size: 0.75em;
  font-weight: 600;
  background: var(--accent-subtle, rgba(70, 107, 103, 0.12));
  color: var(--accent-color, #466b67);
  padding: 2px 8px;
  border-radius: 4px;
  margin-bottom: 8px;
}
.dialogue-bubbles {
  margin-top: 10px;
}
.bubble-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
.bubble-icon {
  font-size: 0.9em;
}
.bubble-input {
  flex: 1;
  background: #fff;
  border: 1px solid #dcdcdc;
  border-radius: 12px;
  padding: 4px 10px;
}
.line-del-btn,
.row-del-btn {
  background: transparent;
  border: none;
  color: #999;
  font-size: 1.1em;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.line-del-btn:hover,
.row-del-btn:hover {
  color: #c00;
}
.add-line-btn,
.secondary-btn {
  display: inline-block;
  margin-top: 6px;
  padding: 4px 10px;
  font-size: 0.82em;
  border: 1px dashed var(--border-color, #bbb);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.add-line-btn:hover,
.secondary-btn:hover {
  border-color: var(--accent-color, #466b67);
  color: var(--accent-color, #466b67);
}
.clarification-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.clar-fields {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  flex: 1;
}
.dynamics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.dynamics-col {
  background: #f8f8f8;
  padding: 10px;
  border-radius: 8px;
}
.dynamics-col h5,
.tone-col h5,
.world-list-col h5 {
  margin: 0 0 8px;
  font-size: 0.9em;
  color: #444;
}
.resource-box {
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  padding: 6px;
  margin-bottom: 6px;
}
.resource-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}
.world-lists-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.world-list-col {
  background: #f8f8f8;
  padding: 10px;
  border-radius: 8px;
}
.list-item-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}
.place-box {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
}
.place-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}
.primary-button {
  background: var(--accent-color, #466b67);
  color: #fff;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 8px 16px;
  font-weight: 500;
  cursor: pointer;
}
.primary-button:disabled {
  opacity: 0.5;
  cursor: default;
}
.footer-actions {
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 768px) {
  .grid-2,
  .tones-grid,
  .clar-fields {
    grid-template-columns: 1fr;
  }
}
</style>
