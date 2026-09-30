import { StepRunStatus } from '@prisma/client';
import {
  DUPLICATE_CALL_STEP_WINDOW_MS,
  isDuplicateCallStep,
  sequenceHasUnfinishedStep,
} from './sequence-step-guard';

describe('sequence-step-guard', () => {
  const now = new Date('2026-09-30T17:13:36.000Z');

  it('trata como duplicada una llamada del mismo paso que ya se está procesando o acaba de salir', () => {
    expect(
      isDuplicateCallStep({
        otherStatus: StepRunStatus.processing,
        now,
      }),
    ).toBe(true);
    expect(
      isDuplicateCallStep({
        otherStatus: StepRunStatus.sent,
        otherStartedAt: new Date(now.getTime() - 30_000),
        now,
      }),
    ).toBe(true);
    expect(
      isDuplicateCallStep({
        otherStatus: StepRunStatus.scheduled,
        now,
      }),
    ).toBe(false);
    expect(
      isDuplicateCallStep({
        otherStatus: StepRunStatus.sent,
        otherStartedAt: new Date(
          now.getTime() - DUPLICATE_CALL_STEP_WINDOW_MS - 1_000,
        ),
        now,
      }),
    ).toBe(false);
  });

  it('mantiene el enrollment abierto si la llamada 3 todavía no tiene run', () => {
    expect(
      sequenceHasUnfinishedStep({
        steps: [{ id: 't7' }, { id: 't10' }],
        runs: [{ stepId: 't7', status: StepRunStatus.sent }],
      }),
    ).toBe(true);
  });

  it('cierra el enrollment cuando todos los pasos tienen un run terminal', () => {
    expect(
      sequenceHasUnfinishedStep({
        steps: [{ id: 't7' }, { id: 't10' }],
        runs: [
          { stepId: 't7', status: StepRunStatus.sent },
          { stepId: 't10', status: StepRunStatus.sent },
        ],
      }),
    ).toBe(false);
  });
});
