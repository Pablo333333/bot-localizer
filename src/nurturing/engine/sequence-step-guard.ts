import { StepRunStatus } from '@prisma/client';

/** Dos jobs del mismo paso que vencen juntos no deben marcar dos llamadas. */
export const DUPLICATE_CALL_STEP_WINDOW_MS = 20 * 60 * 1000;

const OPEN_RUN_STATUSES = new Set<string>([
  StepRunStatus.pending,
  StepRunStatus.scheduled,
  StepRunStatus.processing,
]);

const TERMINAL_RUN_STATUSES = new Set<string>([
  StepRunStatus.sent,
  StepRunStatus.skipped,
  StepRunStatus.failed,
  StepRunStatus.cancelled,
]);

/**
 * true si otro step run del mismo lead y plantilla ya está marcando o acaba de marcar.
 * No cuenta un hermano que sigue en `scheduled`: el primero que toma el lock pasa a
 * `processing` y el segundo lo ve al entrar.
 */
export function isDuplicateCallStep(params: {
  otherStatus: string;
  otherStartedAt?: Date | null;
  now?: Date;
  windowMs?: number;
}): boolean {
  if (params.otherStatus === StepRunStatus.processing) return true;
  if (params.otherStatus !== StepRunStatus.sent || !params.otherStartedAt) {
    return false;
  }
  const now = params.now ?? new Date();
  const windowMs = params.windowMs ?? DUPLICATE_CALL_STEP_WINDOW_MS;
  return now.getTime() - params.otherStartedAt.getTime() < windowMs;
}

/**
 * El enrollment no debe cerrarse mientras quede un paso sin ejecución terminal.
 * En la prueba rápida la llamada 3 no se encola hasta que cierra la llamada 2;
 * si el paso T+7 pasa a `sent` y no hay run de T+10, el enrollment tiene que seguir activo.
 */
export function sequenceHasUnfinishedStep(params: {
  steps: { id: string }[];
  runs: { stepId: string; status: string }[];
}): boolean {
  return params.steps.some((step) => {
    const runs = params.runs.filter((run) => run.stepId === step.id);
    if (runs.some((run) => OPEN_RUN_STATUSES.has(run.status))) return true;
    if (!runs.some((run) => TERMINAL_RUN_STATUSES.has(run.status))) return true;
    return false;
  });
}
