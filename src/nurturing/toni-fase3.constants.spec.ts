import { LeadStatus, TERMINAL_LEAD_STATUSES } from './enums';
import {
  NURTURING_T10_DELAY_MINUTES,
  NURTURING_T7_DELAY_MINUTES,
  RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
  RETELL_FROM_NUMBER_DEFAULT,
  TEMPLATE_CALL_FOLLOWUP_D10,
  TEMPLATE_CALL_FOLLOWUP_D7,
  TONI_NO_ANSWER_MESSAGE,
  TONI_WHATSAPP_SHORT_LINK,
  TWILIO_CONTENT_SID_SEGUIMIENTO_FASE3,
  TWILIO_WHATSAPP_CONTENT_SID_SEGUIMIENTO_FASE3,
  isFollowupCallTemplate,
  parseTwilioContentVariables,
  renderToniNoAnswerFallback,
  resolveCallPhase,
  resolveRetellFollowupAgentId,
  resolveRetellFromNumber,
  resolveWhatsappSeguimientoContentSid,
  twilioSeguimientoContentVariablesJson,
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
    expect(TONI_NO_ANSWER_MESSAGE).toContain('Intentamos contactarte');
    expect(TONI_NO_ANSWER_MESSAGE).toContain('{{1}}');
    expect(TONI_NO_ANSWER_MESSAGE).toContain('{{2}}');
    expect(TONI_NO_ANSWER_MESSAGE).toContain(
      'https://api.leadconnectorhq.com/widget/bookings/cita-para-llamada',
    );
    expect(TONI_NO_ANSWER_MESSAGE).toContain(TONI_WHATSAPP_SHORT_LINK);
    expect(TONI_NO_ANSWER_MESSAGE).toContain('O responde directamente a este mensaje.');
  });

  it('Twilio contentVariables solo envía {{1}} = título', () => {
    expect(
      twilioSeguimientoContentVariablesJson({
        '1': 'Local comercial de 53 m2',
        '2': TONI_WHATSAPP_SHORT_LINK,
      }),
    ).toBe(JSON.stringify({ '1': 'Local comercial de 53 m2' }));
    expect(twilioSeguimientoContentVariablesJson({})).toBe(
      JSON.stringify({ '1': 'tu inmueble comercial' }),
    );
    expect(TONI_WHATSAPP_SHORT_LINK).toBe('wa.me/34644408099');
  });

  it('renderToniNoAnswerFallback usa nombre en saludo y título Twilio {{1}} como inmueble', () => {
    const text = renderToniNoAnswerFallback(
      {
        '1': 'Local en Palma',
      },
      'Toni',
    );
    expect(text).toContain('Hola Toni!');
    expect(text).toContain('inmueble comercial Local en Palma');
    expect(text).toContain(
      'https://api.leadconnectorhq.com/widget/bookings/cita-para-llamada',
    );
    expect(text).not.toContain('{{1}}');
    expect(text).not.toContain('{{2}}');
    expect(parseTwilioContentVariables({ '1': 'Local en Palma' })).toEqual({
      '1': 'Local en Palma',
      '2': '',
    });
  });

  it('Content SID SMS seguimiento ({{1}} título inmueble)', () => {
    expect(TWILIO_CONTENT_SID_SEGUIMIENTO_FASE3).toBe(
      'HX623b40271b0f7fab6282f6548e0ba487',
    );
  });

  it('WhatsApp seguimiento_fase_3_2 usa su Content SID y no el de SMS', () => {
    expect(TWILIO_WHATSAPP_CONTENT_SID_SEGUIMIENTO_FASE3).toBe(
      'HXb5f288b5cb78c4cb9d001ad5be46412e',
    );
    expect(resolveWhatsappSeguimientoContentSid()).toBe(
      'HXb5f288b5cb78c4cb9d001ad5be46412e',
    );
    expect(
      resolveWhatsappSeguimientoContentSid({
        payloadSid: TWILIO_CONTENT_SID_SEGUIMIENTO_FASE3,
      }),
    ).toBe('HXb5f288b5cb78c4cb9d001ad5be46412e');
    expect(
      resolveWhatsappSeguimientoContentSid({ envSid: '' }),
    ).toBeUndefined();
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
    // Sin template/phase: follow-up agent ya NO se asume t7 (evita saltar ILOCALIZABLE).
    expect(
      resolveCallPhase({
        agentId: RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
        followupAgentId: RETELL_FOLLOWUP_AGENT_ID_DEFAULT,
      }),
    ).toBe('unknown');
  });

  it('ILOCALIZABLE es estado terminal', () => {
    expect(LeadStatus.ILOCALIZABLE).toBe('ilocalizable');
    expect(TERMINAL_LEAD_STATUSES.has(LeadStatus.ILOCALIZABLE)).toBe(true);
  });

  it('PENDIENTE no es terminal (permite T+7/T+10)', () => {
    expect(LeadStatus.PENDIENTE).toBe('pendiente');
    expect(TERMINAL_LEAD_STATUSES.has(LeadStatus.PENDIENTE)).toBe(false);
  });
});
