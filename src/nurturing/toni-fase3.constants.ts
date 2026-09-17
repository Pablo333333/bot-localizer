/** Agente Retell de re-llamada (T+7 y T+10). */
export const RETELL_FOLLOWUP_AGENT_ID_DEFAULT =
  'agent_25c341a3bcc06e505b5ed2850c';

/** Remitente Toni (+34 871 075 112). */
export const RETELL_FROM_NUMBER_DEFAULT = '+34871075112';

export const TONI_BOOKING_LINK =
  'https://api.leadconnectorhq.com/widget/bookings/cita-para-llamada';

export const TONI_NO_ANSWER_MESSAGE =
  'Hola, soy Localisto de Localicer 👋 Hemos intentado contactar contigo porque hemos localizado tu anuncio y nos gustaría confirmar algunos datos para poder ayudarte a darle visibilidad Gratis en Localicer.com. Si te viene mejor, puedes elegir directamente cuándo quieres que te llamemos: 👉 https://api.leadconnectorhq.com/widget/bookings/cita-para-llamada ¡Gracias!';

/** T+7 = 7 días = 10080 min */
export const NURTURING_T7_DELAY_MINUTES = 10_080;
/** T+10 = 10 días = 14400 min */
export const NURTURING_T10_DELAY_MINUTES = 14_400;

export const TEMPLATE_CALL_FOLLOWUP_D7 = 'nurturing.call.followup_d7';
export const TEMPLATE_CALL_FOLLOWUP_D10 = 'nurturing.call.followup_d10';
export const TEMPLATE_WA_T0 = 'nurturing.whatsapp.no_answer_t0';
/** SMS T+0 / seguimiento (Content Template Twilio aprobado para SMS). */
export const TEMPLATE_SMS_T0 = 'nurturing.sms.no_answer_t0';
export const TEMPLATE_SMS_T7 = 'nurturing.sms.followup_d7';

/**
 * Content SID Twilio `seguimiento_lead_fase3`.
 * Aprobado para SMS; aún NO para WhatsApp Business Initiated.
 * Override: TWILIO_SMS_CONTENT_SID / TWILIO_CONTENT_SID_SEGUIMIENTO.
 */
export const TWILIO_CONTENT_SID_SEGUIMIENTO_FASE3 =
  'HXc7bd38988127fbe33808deb0785466cf';

export const DEFAULT_TONI_SEQUENCE_NAME =
  'Seguimiento Toni (T+0 WA/SMS → T+7 Call → T+10 Call)';

export const LEGACY_TONI_SEQUENCE_NAMES = [
  'Seguimiento Toni (Call → WA → Call 7d)',
];

export type NurturingCallPhase = 't0' | 't7' | 't10' | 'unknown';

export function isFollowupCallTemplate(templateKey?: string | null): boolean {
  return (
    templateKey === TEMPLATE_CALL_FOLLOWUP_D7 ||
    templateKey === TEMPLATE_CALL_FOLLOWUP_D10
  );
}

export function resolveRetellFollowupAgentId(envValue?: string | null): string {
  const v = (envValue || '').trim();
  return v || RETELL_FOLLOWUP_AGENT_ID_DEFAULT;
}

export function resolveRetellFromNumber(envValue?: string | null): string {
  const v = (envValue || '').trim();
  if (!v || v.includes('X') || v.startsWith('+1XXXXXXXX')) {
    return RETELL_FROM_NUMBER_DEFAULT;
  }
  return v.replace(/\s+/g, '');
}

/**
 * Fase de la llamada nurturing.
 * Prioridad: nurturing_phase explícita → template_key → agent_id.
 * Misma agent follow-up para T+7 y T+10: sin template/phase NO asumir t7
 * (evita SMS T+7 en vez de ILOCALIZABLE en T+10).
 */
export function resolveCallPhase(params: {
  agentId?: string;
  templateKey?: string | null;
  outboundAgentId?: string;
  followupAgentId?: string;
  nurturingPhase?: string | null;
}): NurturingCallPhase {
  const explicit = String(params.nurturingPhase || '')
    .toLowerCase()
    .trim()
    .replace(/^nurturing[._-]?/, '')
    .replace(/^phase[._-]?/, '');
  if (explicit === 't0' || explicit === 't7' || explicit === 't10') {
    return explicit;
  }
  if (explicit === 'd7' || explicit === 'day7' || explicit === 'followup_d7') {
    return 't7';
  }
  if (explicit === 'd10' || explicit === 'day10' || explicit === 'followup_d10') {
    return 't10';
  }

  const template = String(params.templateKey || '').trim();
  if (template === TEMPLATE_CALL_FOLLOWUP_D7) return 't7';
  if (template === TEMPLATE_CALL_FOLLOWUP_D10) return 't10';
  if (/followup_d10|call\.d10|\.t10\b/i.test(template)) return 't10';
  if (/followup_d7|call\.d7|\.t7\b/i.test(template)) return 't7';

  if (
    params.agentId &&
    params.outboundAgentId &&
    params.agentId === params.outboundAgentId
  ) {
    return 't0';
  }

  // Follow-up agent sin template/phase → unknown (resolveTemplateKey en BD debe aclarar).
  return 'unknown';
}
