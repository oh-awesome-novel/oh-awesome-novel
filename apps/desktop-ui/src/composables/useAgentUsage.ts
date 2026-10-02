import { computed, onScopeDispose, shallowRef, type ComputedRef } from 'vue';
import type { UIMessage } from 'ai';
import { parseAgentUsageRecord } from '@oh-awesome-novel/client';
import type { AgentUsageRecord, AgentGovernanceHistory } from '@oh-awesome-novel/client';
import { oanClient } from '../client';

export function useAgentUsage(messages: ComputedRef<UIMessage[]>) {
  const expanded = shallowRef(false);
  const selectedSession = shallowRef('live');
  const sessions = shallowRef<Array<{ id: string; updatedAt: string }>>([]);
  const history = shallowRef<AgentGovernanceHistory>();
  const loading = shallowRef(false);
  const error = shallowRef('');
  let sequence = 0;
  onScopeDispose(() => { sequence++; });
  const live = computed(() => {
    const records: AgentUsageRecord[] = []; const warnings: string[] = [];
    for (const message of messages.value) for (const part of message.parts) {
      if (part.type === 'data-usage-warning') {
        const code = part.data && typeof part.data === 'object' && 'code' in part.data ? part.data.code : undefined;
        warnings.push(code === 'invalid-metadata' ? '统计格式不受支持，已忽略该记录。' : '本轮统计未能持久化；实时数据仍可查看。');
      }
      if (part.type !== 'data-agent-usage') continue;
      try { records.push(parseAgentUsageRecord(part.data)); }
      catch { warnings.push('统计格式不受支持，已忽略该记录。'); }
    }
    return { records, warnings: [...new Set(warnings)] };
  });
  const records = computed(() => selectedSession.value === 'live' ? live.value.records : history.value?.records ?? []);
  const warnings = computed(() => selectedSession.value === 'live' ? live.value.warnings : [
    ...(history.value?.diagnostics.map((code) => ({
      missing: '该会话没有统计记录。', 'truncated-tail': '记录尾行不完整，已显示此前完整记录。',
      'invalid-record': '部分统计格式不受支持或损坏，已跳过。', 'read-failed': '无法安全读取统计文件。', 'size-limit': '统计文件超过读取上限。',
    }[code])) ?? []),
    ...(history.value?.truncated ? ['仅显示最近的有界统计记录。'] : []),
  ]);
  async function refreshSessions() {
    const version = ++sequence; loading.value = true; error.value = '';
    try { const value = await oanClient.listAgentUsageSessions(); if (version === sequence) sessions.value = value.sessions; }
    catch { if (version === sequence) error.value = '无法载入历史统计。'; }
    finally { if (version === sequence) loading.value = false; }
  }
  async function selectSession(id: string) {
    selectedSession.value = id; history.value = undefined; error.value = '';
    const version = ++sequence;
    if (id === 'live') { loading.value = false; return; }
    loading.value = true;
    try { const value = await oanClient.getAgentGovernanceHistory(id, 100); if (version === sequence) history.value = value; }
    catch { if (version === sequence) error.value = '无法载入此会话的统计。'; }
    finally { if (version === sequence) loading.value = false; }
  }
  function toggle() { expanded.value = !expanded.value; if (expanded.value) void refreshSessions(); }
  return { expanded, selectedSession, sessions, records, warnings, loading, error, toggle, refreshSessions, selectSession };
}
