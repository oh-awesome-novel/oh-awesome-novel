/**
 * Shared Chinese author-language labels for Play enum values. Protocol values
 * stay English identifiers; only their display goes through these maps.
 */
export const PLAY_SIMULATION_MODE_LABELS: Readonly<Record<string, string>> = {
  conversation: '对话为主',
  reactiveWorld: '世界会回应',
  activeWorld: '世界主动推进',
};

export const PLAY_EVENT_DENSITY_LABELS: Readonly<Record<string, string>> = {
  quiet: '平静',
  balanced: '适中',
  volatile: '多变',
};

export function formatPlayWorldActivity(policy: { simulationMode: string; density: string }): string {
  return `${PLAY_SIMULATION_MODE_LABELS[policy.simulationMode] ?? policy.simulationMode} · ${PLAY_EVENT_DENSITY_LABELS[policy.density] ?? policy.density}`;
}

export const PLAY_SOURCE_DRIFT_STATE_LABELS: Readonly<Record<string, string>> = {
  current: '未变化',
  changed: '已变化',
  missing: '缺失',
  invalid: '无效',
};

export const PLAY_START_MODE_LABELS: Readonly<Record<string, string>> = {
  quick: '快速开局',
  guided: '引导开局',
};

export const PLAY_OUTCOME_CONFIDENCE_LABELS: Readonly<Record<string, string>> = {
  confirmed: '已确认',
  inferred: '推断',
  authorProvided: '作者提供',
};

export const PLAY_OUTCOME_GOAL_STATUS_LABELS: Readonly<Record<string, string>> = {
  reached: '已达成',
  partial: '部分达成',
  missed: '未达成',
  changed: '目标已改变',
};

export const PLAY_OUTCOME_TAG_LABELS: Readonly<Record<string, string>> = {
  goal: '目标',
  divergence: '偏离',
  consistency: '一致性',
  worldChange: '世界变化',
  participantFootprint: '人物足迹',
  writingMaterial: '写作素材',
};

export const PLAY_VISIBILITY_LABELS: Readonly<Record<string, string>> = {
  playerVisible: '参与者可见',
  rumor: '传闻',
  playerUnknown: '参与者不知道',
};

export const PLAY_PRESSURE_KIND_LABELS: Readonly<Record<string, string>> = {
  deadline: '期限', pursuit: '追逐', factionProject: '势力计划', environment: '环境', rumor: '传闻', relationship: '关系',
};

export const PLAY_AGENDA_STATUS_LABELS: Readonly<Record<string, string>> = {
  active: '进行中', blocked: '受阻', completed: '已完成', abandoned: '已放弃',
};

export const PLAY_REHEARSAL_ATTEMPT_STATUS_LABELS: Readonly<Record<string, string>> = {
  idle: '空闲', running: '生成中', prepared: '已生成', committing: '提交中', committed: '已提交', cancelled: '已取消', failed: '失败',
};

export const PLAY_REHEARSAL_STEP_STATUS_LABELS: Readonly<Record<string, string>> = {
  provisional: '临时', selected: '已采用', committed: '已提交', superseded: '已替换',
};

export const PLAY_NARRATIVE_BLOCK_KIND_LABELS: Readonly<Record<string, string>> = {
  narrator: '旁白', characterSpeech: '台词', characterAction: '动作', worldNotice: '世界提示',
};

export const PLAY_WRITING_REFERENCE_STATUS_LABELS: Readonly<Record<string, string>> = {
  active: '生效', detached: '已解除', stale: '已过期',
};

export const PLAY_OUTCOME_STALE_REASON_LABELS: Readonly<Record<string, string>> = {
  sessionRevisionChanged: '会话已更新',
  selectedBranchChanged: '选中分支已改变',
  sourceSnapshotChanged: '来源内容已改变',
};
