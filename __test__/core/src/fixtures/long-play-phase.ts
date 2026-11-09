import { createPlaySessionDraft, settlePlayWorldRefereeResponse } from '@oh-awesome-novel/core';

export function longSession(count: number) {
  const s = settlePlayWorldRefereeResponse({ session: createPlaySessionDraft({ id: 'phase-source', title: 'Gate', sceneStart: 'Gate', characters: [] }),
    actionKind: 'do', userText: 'wait', refereeResponse: 'at the gate\n```oan-play-settlement\n{"events":[],"stateDelta":{"medicine":2},"observations":[],"suggestedActions":[]}\n```' });
  const template = s.turnArtifacts[0]!;
  const turn = (revision: number, parent: number, text: string) => {
    const artifact = structuredClone(template);
    artifact.id = 'turn-artifact-' + revision; artifact.revision = revision;
    if (parent) artifact.parentTurnId = 'turn-artifact-' + parent;
    artifact.worldClock = { turn: parent + 1, revision };
    artifact.messages.forEach((message, i) => { message.id = `turn-${revision}-${i ? 'referee' : 'user'}`; });
    artifact.messages[1]!.content = text;
    return artifact;
  };
  s.turnArtifacts = Array.from({ length: count }, (_, i) => turn(i + 1, i, 'at the gate ' + (i + 1)));
  s.selectedTurnIds = s.turnArtifacts.map(t => t.id);
  s.transcript = s.turnArtifacts.flatMap(t => t.messages);
  s.turnArtifacts.push(turn(count + 1, 1, 'SIBLING_ONLY'));
  s.worldClock = { turn: count, revision: count + 1 }; s.revision = count + 1;
  return s;
}
