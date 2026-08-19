import { LeadStatus, TERMINAL_LEAD_STATUSES } from './enums';
import {
  NURTURING_T10_DELAY_MINUTES,
  NURTURING_T7_DELAY_MINUTES,
  RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
  RETELL_FROM_NUMBER_DEFAULT,
  TEMPLATE_CALL_FOLLOWUP_D10,
  TEMPLATE_CALL_FOLLOWUP_D7,
  TONI_NO_ANSWER_MESSAGE,
  isFollowupCallTemplate,
  resolveCallPhase,
  resolveRetellFollowupAgentId,
  resolveRetellFromNumber,
} from './toni-fase3.constants';

describe('Toni Fase 3 constants', () => {
  it('delays T+7 / T+10 en minutos', () => {
    expect(NURTURING_T7_DELAY_MINUTES).toBe(10_080);
    expect(NURTURING_T10_DELAY_MINUTES).toBe(14_400);
  });

  it('agente follow-up y from number por defecto', () => {
    expect(RETELL_FOLLOWUP_AGENT_ID_DEFAULT).toBe(
      'agent_25c341a3bcc06e505b5ed2850c',
    );
    expect(resolveRetellFollowupAgentId(undefined)).toBe(
      RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
    );
    expect(resolveRetellFollowupAgentId('  ')).toBe(
      RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
    );
    expect(RETELL_FROM_NUMBER_DEFAULT).toBe('+34871075112');
    expect(resolveRetellFromNumber('+1XXXXXXXXXX')).toBe('+34871075112');
    expect(resolveRetellFromNumber('+34 871 075 112')).toBe('+34871075112');
  });

  it('plantilla T+0 incluye link de agendamiento Toni', () => {
    expect(TONI_NO_ANSWER_MESSAGE).toContain('Localisto de Localicer');
    expect(TONI_NO_ANSWER_MESSAGE).toContain(
      'https://api.leadconnectorhq.com/widget/bookings/cita-para-llamada',
    );
  });

  it('templates T+7/T+10 son follow-up', () => {
    expect(isFollowupCallTemplate(TEMPLATE_CALL_FOLLOWUP_D7)).toBe(true);
    expect(isFollowupCallTemplate(TEMPLATE_CALL_FOLLOWUP_D10)).toBe(true);
    expect(isFollowupCallTemplate('nurturing.call.outbound_d0')).toBe(false);
  });

  it('resuelve fase t0 / t7 / t10', () => {
    expect(
      resolveCallPhase({
        agentId: 'agent_outbound',
        outboundAgentId: 'agent_outbound',
        followupAgentId: RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
      }),
    ).toBe('t0');
    expect(
      resolveCallPhase({
        templateKey: TEMPLATE_CALL_FOLLOWUP_D7,
        agentId: RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
        followupAgentId: RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
      }),
    ).toBe('t7');
    expect(
      resolveCallPhase({
        templateKey: TEMPLATE_CALL_FOLLOWUP_D10,
        agentId: RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
      }),
    ).toBe('t10');
    expect(
      resolveCallPhase({
        agentId: RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
        followupAgentId: RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
        nurturingPhase: 't10',
      }),
    ).toBe('t10');
  });

  it('ILOCALIZABLE es estado terminal', () => {
    expect(LeadStatus.ILOCALIZABLE).toBe('ilocalizable');
    expect(TERMINAL_LEAD_STATUSES.has(LeadStatus.ILOCALIZABLE)).toBe(true);
  });
});
