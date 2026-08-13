export interface NurturingStepJobData {
  stepRunId: string;
  enrollmentId: string;
  leadId: string;
}

export function stepRunJobId(stepRunId: string): string {
  return `nurturing:step-run:${stepRunId}`;
}
