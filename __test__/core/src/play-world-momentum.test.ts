import { describe, expect, it } from 'vitest';

import {
  applyPlayWorldMomentumChanges,
  assertPlayWorldMomentumTransition,
  evaluatePlayEligibleWorldEvents,
  formatPlayRelativeTimeAdvance,
  normalizePlayAgendaChanges,
  normalizePlayPressureChanges,
  normalizePlayRelativeTimeAdvance,
  normalizePlayWorldMomentum,
} from '@oh-awesome-novel/core';
import type {
  PlayEventPolicy,
  PlayWorldMomentum,
} from '@oh-awesome-novel/core';

const balancedReactivePolicy: PlayEventPolicy = {
  simulationMode: 'reactiveWorld',
  density: 'balanced',
  allowOffscreen: true,
  allowHidden: true,
  maxExternalEventsPerTurn: 4,
};

describe('Play world momentum schema', () => {
  it('normalizes a strict pressure and agenda snapshot', () => {
    expect(normalizePlayWorldMomentum({
      pressures: [{
        id: 'deadline-1',
        kind: 'deadline',
        label: '  The last train departs  ',
        status: 'active',
        level: 2,
        threshold: 3,
        causeRefs: ['seed-event'],
        nextConsequence: '  The platform closes.  ',
        visibility: 'playerVisible',
      }],
      agendas: [{
        id: 'inspector-search',
        ownerEntityId: '  inspector  ',
        goal: '  Find the missing passenger.  ',
        nextMove: '  Search the east platform.  ',
        blockers: ['  locked-gate  '],
        status: 'blocked',
        visibility: 'playerUnknown',
        updatedAtTurnId: 'seed-turn',
      }],
    })).toEqual({
      pressures: [{
        id: 'deadline-1',
        kind: 'deadline',
        label: 'The last train departs',
        status: 'active',
        level: 2,
        threshold: 3,
        causeRefs: ['seed-event'],
        nextConsequence: 'The platform closes.',
        visibility: 'playerVisible',
      }],
      agendas: [{
        id: 'inspector-search',
        ownerEntityId: 'inspector',
        goal: 'Find the missing passenger.',
        nextMove: 'Search the east platform.',
        blockers: ['locked-gate'],
        status: 'blocked',
        visibility: 'playerUnknown',
        updatedAtTurnId: 'seed-turn',
      }],
    });
  });

  it('rejects unknown fields, duplicate ids, unsafe ids, and invalid meters', () => {
    expect(() => normalizePlayWorldMomentum({
      ...momentumFixture(),
      futureField: true,
    })).toThrow('unknown fields');

    const duplicatePressure = momentumFixture();
    duplicatePressure.pressures.push({ ...duplicatePressure.pressures[0]! });
    expect(() => normalizePlayWorldMomentum(duplicatePressure))
      .toThrow('duplicate pressure id');

    const duplicateAgenda = momentumFixture();
    duplicateAgenda.agendas.push({ ...duplicateAgenda.agendas[0]! });
    expect(() => normalizePlayWorldMomentum(duplicateAgenda))
      .toThrow('duplicate agenda id');

    expect(() => normalizePlayWorldMomentum({
      pressures: [{
        ...momentumFixture().pressures[0],
        id: '../deadline',
      }],
      agendas: [],
    })).toThrow('Invalid Play pressure id');
    expect(() => normalizePlayWorldMomentum({
      pressures: [{
        ...momentumFixture().pressures[0],
        threshold: undefined,
      }],
      agendas: [],
    })).toThrow('level and threshold must appear together');
    expect(() => normalizePlayWorldMomentum({
      pressures: [{
        ...momentumFixture().pressures[0],
        level: 4,
        threshold: 3,
      }],
      agendas: [],
    })).toThrow('level cannot exceed its threshold');
  });

  it('normalizes typed changes and rejects ambiguous or duplicate transitions', () => {
    expect(normalizePlayPressureChanges([{
      pressureId: 'deadline-1',
      reason: '  The deadline was reached.  ',
      status: 'resolved',
      nextConsequence: null,
    }])).toEqual([{
      pressureId: 'deadline-1',
      reason: 'The deadline was reached.',
      status: 'resolved',
      nextConsequence: null,
    }]);
    expect(normalizePlayAgendaChanges([{
      agendaId: 'inspector-search',
      reason: 'The gate opened.',
      status: 'active',
      blockers: [],
    }])).toEqual([{
      agendaId: 'inspector-search',
      reason: 'The gate opened.',
      status: 'active',
      blockers: [],
    }]);

    expect(() => normalizePlayPressureChanges([{
      pressureId: 'deadline-1',
      reason: 'No-op.',
    }])).toThrow('has no state change');
    expect(() => normalizePlayAgendaChanges([{
      agendaId: 'inspector-search',
      reason: 'No-op.',
      futureField: true,
    }])).toThrow('unknown fields');

    const current = momentumFixture();
    expect(() => applyPlayWorldMomentumChanges({
      momentum: current,
      pressureChanges: [
        { pressureId: 'deadline-1', reason: 'One.', level: 2 },
        { pressureId: 'deadline-1', reason: 'Two.', status: 'resolved' },
      ],
      agendaChanges: [],
      refereeTurnId: 'turn-2-referee',
    })).toThrow('duplicate id');
    expect(() => applyPlayWorldMomentumChanges({
      momentum: current,
      pressureChanges: [{
        pressureId: 'missing-pressure',
        reason: 'Forged.',
        status: 'resolved',
      }],
      agendaChanges: [],
      refereeTurnId: 'turn-2-referee',
    })).toThrow('unknown pressure');
    expect(() => applyPlayWorldMomentumChanges({
      momentum: current,
      pressureChanges: [{
        pressureId: 'deadline-1',
        reason: 'Claims movement without changing state.',
        level: 1,
      }],
      agendaChanges: [],
      refereeTurnId: 'turn-2-referee',
    })).toThrow('does not advance state');
    expect(() => applyPlayWorldMomentumChanges({
      momentum: current,
      pressureChanges: [],
      agendaChanges: [{
        agendaId: 'inspector-search',
        reason: 'Claims movement without changing state.',
        nextMove: 'Search the east platform.',
      }],
      refereeTurnId: 'turn-2-referee',
    })).toThrow('does not advance state');
  });

  it('applies host-owned evidence and protects terminal records', () => {
    const current = momentumFixture();
    const next = applyPlayWorldMomentumChanges({
      momentum: current,
      pressureChanges: [{
        pressureId: 'deadline-1',
        reason: 'The platform closed.',
        status: 'resolved',
        level: 3,
        nextConsequence: null,
      }],
      agendaChanges: [{
        agendaId: 'inspector-search',
        reason: 'The search moved on.',
        status: 'completed',
        nextMove: null,
      }],
      refereeTurnId: 'turn-2-referee',
      pressureEventIds: new Map([['deadline-1', ['turn-2-event-1']]]),
    });

    expect(current).toEqual(momentumFixture());
    expect(next.pressures[0]).toMatchObject({
      status: 'resolved',
      level: 3,
      causeRefs: ['seed-event', 'turn-2-event-1'],
    });
    expect(next.pressures[0]).not.toHaveProperty('nextConsequence');
    expect(next.agendas[0]).toMatchObject({
      status: 'completed',
      updatedAtTurnId: 'turn-2-referee',
    });
    expect(next.agendas[0]).not.toHaveProperty('nextMove');
    expect(() => applyPlayWorldMomentumChanges({
      momentum: next,
      pressureChanges: [{
        pressureId: 'deadline-1',
        reason: 'Cannot reopen.',
        status: 'active',
      }],
      agendaChanges: [],
      refereeTurnId: 'turn-3-referee',
    })).toThrow('Resolved Play pressure cannot change');
    expect(() => applyPlayWorldMomentumChanges({
      momentum: next,
      pressureChanges: [],
      agendaChanges: [{
        agendaId: 'inspector-search',
        reason: 'Cannot reopen.',
        status: 'active',
      }],
      refereeTurnId: 'turn-3-referee',
    })).toThrow('Terminal Play agenda cannot change');
  });

  it('rejects record removal, numeric-contract drift, and immutable identity drift', () => {
    const previous = momentumFixture();
    expect(() => assertPlayWorldMomentumTransition(previous, {
      pressures: [],
      agendas: previous.agendas,
    })).toThrow('cannot be added or removed');
    expect(() => assertPlayWorldMomentumTransition(previous, {
      pressures: [{ ...previous.pressures[0]!, threshold: 4 }],
      agendas: previous.agendas,
    })).toThrow('numeric contract cannot change');
    expect(() => assertPlayWorldMomentumTransition(previous, {
      pressures: [{ ...previous.pressures[0]!, label: 'Forged label' }],
      agendas: previous.agendas,
    })).toThrow('immutable identity cannot change');
    expect(() => assertPlayWorldMomentumTransition(previous, {
      pressures: previous.pressures,
      agendas: [{ ...previous.agendas[0]!, ownerEntityId: 'forged-owner' }],
    })).toThrow('immutable identity cannot change');
  });
});

describe('Play eligible world-event evaluator', () => {
  it('applies simulation mode, density, and wait semantics', () => {
    const momentum = evaluatorMomentumFixture();
    const conversationIdle = evaluatePlayEligibleWorldEvents({
      momentum,
      eventPolicy: { ...balancedReactivePolicy, simulationMode: 'conversation' },
      actionKind: 'say',
      sceneEntityIds: ['inspector'],
    });
    expect(conversationIdle).toEqual({ effectiveBudget: 0, candidates: [] });

    const conversationWait = evaluatePlayEligibleWorldEvents({
      momentum,
      eventPolicy: { ...balancedReactivePolicy, simulationMode: 'conversation' },
      actionKind: 'wait',
      sceneEntityIds: [],
    });
    expect(conversationWait.effectiveBudget).toBe(1);
    expect(conversationWait.candidates.map((candidate) => candidate.id))
      .toEqual(['pressure.pursuit-1']);

    const reactiveWait = evaluatePlayEligibleWorldEvents({
      momentum,
      eventPolicy: balancedReactivePolicy,
      actionKind: 'wait',
      timeAdvance: { amount: 2, unit: 'hour' },
      sceneEntityIds: [],
    });
    expect(reactiveWait.effectiveBudget).toBe(1);
    expect(reactiveWait.candidates.map((candidate) => candidate.id))
      .toEqual(['pressure.pursuit-1']);

    const reactiveVolatile = evaluatePlayEligibleWorldEvents({
      momentum,
      eventPolicy: { ...balancedReactivePolicy, density: 'volatile' },
      actionKind: 'wait',
      sceneEntityIds: [],
    });
    expect(reactiveVolatile.effectiveBudget).toBe(2);
    expect(reactiveVolatile.candidates.map((candidate) => candidate.id))
      .toEqual(['pressure.pursuit-1', 'agenda.inspector-search']);

    const activeVolatile = evaluatePlayEligibleWorldEvents({
      momentum,
      eventPolicy: {
        ...balancedReactivePolicy,
        simulationMode: 'activeWorld',
        density: 'volatile',
      },
      actionKind: 'say',
      sceneEntityIds: [],
    });
    expect(activeVolatile.effectiveBudget).toBe(2);
    expect(activeVolatile.candidates.map((candidate) => candidate.id))
      .toEqual(['pressure.pursuit-1', 'agenda.inspector-search']);
  });

  it('prioritizes threshold pressure and respects visibility policy', () => {
    const momentum = evaluatorMomentumFixture();
    momentum.pressures.unshift({
      id: 'hidden-deadline',
      kind: 'deadline',
      label: 'Hidden deadline',
      status: 'active',
      level: 2,
      threshold: 2,
      causeRefs: ['seed-event'],
      nextConsequence: 'The hidden deadline expires.',
      visibility: 'playerUnknown',
    });
    const hiddenDisabled = evaluatePlayEligibleWorldEvents({
      momentum,
      eventPolicy: {
        ...balancedReactivePolicy,
        simulationMode: 'activeWorld',
        density: 'volatile',
        allowHidden: false,
      },
      actionKind: 'wait',
    });
    expect(hiddenDisabled.candidates.map((candidate) => candidate.id))
      .not.toContain('pressure.hidden-deadline');

    const hiddenEnabled = evaluatePlayEligibleWorldEvents({
      momentum,
      eventPolicy: {
        ...balancedReactivePolicy,
        simulationMode: 'activeWorld',
        density: 'volatile',
      },
      actionKind: 'wait',
    });
    expect(hiddenEnabled.candidates[0]).toMatchObject({
      id: 'pressure.hidden-deadline',
      priority: 360,
    });
  });

  it('is deterministic and does not mutate its inputs', () => {
    const momentum = evaluatorMomentumFixture();
    const before = structuredClone(momentum);
    const input = {
      momentum,
      eventPolicy: {
        ...balancedReactivePolicy,
        simulationMode: 'activeWorld' as const,
        density: 'volatile' as const,
      },
      actionKind: 'wait' as const,
      timeAdvance: { amount: 30, unit: 'minute' as const },
      sceneEntityIds: ['inspector'],
    };

    const first = evaluatePlayEligibleWorldEvents(input);
    const second = evaluatePlayEligibleWorldEvents(input);
    expect(second).toEqual(first);
    expect(momentum).toEqual(before);
  });
});

describe('Play relative time advance', () => {
  it('normalizes bounded time and formats stable ISO durations', () => {
    expect(normalizePlayRelativeTimeAdvance({ amount: 15, unit: 'minute' }))
      .toEqual({ amount: 15, unit: 'minute' });
    expect(formatPlayRelativeTimeAdvance({ amount: 15, unit: 'minute' }))
      .toBe('PT15M');
    expect(formatPlayRelativeTimeAdvance({ amount: 2, unit: 'hour' }))
      .toBe('PT2H');
    expect(formatPlayRelativeTimeAdvance({ amount: 3, unit: 'day' }))
      .toBe('P3D');
    expect(normalizePlayRelativeTimeAdvance({ amount: 365, unit: 'day' }))
      .toEqual({ amount: 365, unit: 'day' });
  });

  it('rejects unknown fields, invalid units, non-positive values, and overlong waits', () => {
    expect(() => normalizePlayRelativeTimeAdvance({
      amount: 1,
      unit: 'hour',
      guess: true,
    })).toThrow('unknown fields');
    expect(() => normalizePlayRelativeTimeAdvance({ amount: 0, unit: 'hour' }))
      .toThrow('positive safe integer');
    expect(() => normalizePlayRelativeTimeAdvance({ amount: 1, unit: 'week' }))
      .toThrow('Invalid Play time advance unit');
    expect(() => normalizePlayRelativeTimeAdvance({ amount: 366, unit: 'day' }))
      .toThrow('cannot exceed one year');
  });
});

function momentumFixture(): PlayWorldMomentum {
  return {
    pressures: [{
      id: 'deadline-1',
      kind: 'deadline',
      label: 'The last train departs',
      status: 'active',
      level: 1,
      threshold: 3,
      causeRefs: ['seed-event'],
      nextConsequence: 'The platform closes.',
      visibility: 'playerVisible',
    }],
    agendas: [{
      id: 'inspector-search',
      ownerEntityId: 'inspector',
      goal: 'Find the missing passenger.',
      nextMove: 'Search the east platform.',
      blockers: [],
      status: 'active',
      visibility: 'playerVisible',
      updatedAtTurnId: 'seed-turn',
    }],
  };
}

function evaluatorMomentumFixture(): PlayWorldMomentum {
  return {
    pressures: [{
      id: 'pursuit-1',
      kind: 'pursuit',
      label: 'The patrol is approaching',
      status: 'active',
      level: 1,
      threshold: 3,
      causeRefs: ['seed-event'],
      nextConsequence: 'The patrol reaches the platform.',
      visibility: 'playerVisible',
    }],
    agendas: [{
      id: 'inspector-search',
      ownerEntityId: 'inspector',
      goal: 'Find the missing passenger.',
      nextMove: 'Search the east platform.',
      blockers: [],
      status: 'active',
      visibility: 'playerVisible',
      updatedAtTurnId: 'seed-turn',
    }],
  };
}
