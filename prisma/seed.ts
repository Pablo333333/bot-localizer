import { Channel, PrismaClient } from '@prisma/client';
import {
  DEFAULT_TONI_SEQUENCE_NAME,
  LEGACY_TONI_SEQUENCE_NAMES,
  NURTURING_T10_DELAY_MINUTES,
  NURTURING_T7_DELAY_MINUTES,
  TEMPLATE_CALL_FOLLOWUP_D10,
  TEMPLATE_CALL_FOLLOWUP_D7,
  TONI_BOOKING_LINK,
} from '../src/nurturing/toni-fase3.constants';

const prisma = new PrismaClient();

/**
 * Secuencia Fase 3 Toni:
 * T+0 WhatsApp (sin SMS) lo dispara NoAnswerFollowup tras la 1ª llamada outbound (no-contesta).
 * Esta secuencia solo programa re-llamadas:
 *   T+7  (10080 min) llamada agente follow-up → si falla: SMS con enlace de cita
 *   T+10 (14400 min) última llamada agente follow-up → si no hay contacto: ILOCALIZABLE
 */
async function main() {
  await prisma.sequence.updateMany({
    where: { isDefault: true },
    data: { isDefault: false, isActive: false },
  });

  await prisma.sequence.updateMany({
    where: { name: { in: LEGACY_TONI_SEQUENCE_NAMES } },
    data: { isDefault: false, isActive: false },
  });

  const existing = await prisma.sequence.findFirst({
    where: { name: DEFAULT_TONI_SEQUENCE_NAME },
    include: { steps: true },
  });

  const stepsCreate = [
    {
      order: 1,
      channel: Channel.llamada,
      delayMinutes: NURTURING_T7_DELAY_MINUTES,
      templateKey: TEMPLATE_CALL_FOLLOWUP_D7,
      templatePayload: {
        summary: 'Segunda llamada de seguimiento (T+7 días)',
        retellVariables: { nurturing_phase: 't7' },
      },
      maxRetries: 2,
    },
    {
      order: 2,
      channel: Channel.llamada,
      delayMinutes: NURTURING_T10_DELAY_MINUTES,
      templateKey: TEMPLATE_CALL_FOLLOWUP_D10,
      templatePayload: {
        summary: 'Tercera y última llamada de seguimiento (T+10 días)',
        retellVariables: { nurturing_phase: 't10' },
      },
      maxRetries: 2,
    },
  ];

  if (existing) {
    await prisma.sequence.update({
      where: { id: existing.id },
      data: {
        isDefault: true,
        isActive: true,
        description:
          'Tras no-contesta T+0 (solo WhatsApp inmediato, sin SMS): re-llamada T+7 (SMS si falla) y T+10 con agente follow-up. Sin contacto en T+10 → ILOCALIZABLE.',
      },
    });

    const expected = [
      { delay: NURTURING_T7_DELAY_MINUTES, key: TEMPLATE_CALL_FOLLOWUP_D7 },
      { delay: NURTURING_T10_DELAY_MINUTES, key: TEMPLATE_CALL_FOLLOWUP_D10 },
    ];
    const matches =
      existing.steps.length === 2 &&
      expected.every((e, i) => {
        const s = existing.steps.find((st) => st.order === i + 1);
        return s?.delayMinutes === e.delay && s?.templateKey === e.key;
      });

    if (!matches) {
      console.log(
        'Pasos de la secuencia Toni desactualizados; se mantienen (hay StepRuns). Crea una secuencia nueva si hace falta re-seed limpio.',
      );
    }

    console.log(`Secuencia Toni reactivada: ${existing.id}`);
    return;
  }

  const sequence = await prisma.sequence.create({
    data: {
      name: DEFAULT_TONI_SEQUENCE_NAME,
      description:
        `T+0 solo WhatsApp (NoAnswerFollowup, link ${TONI_BOOKING_LINK}; SMS omitido). ` +
        'T+7 llamada follow-up + SMS si no contesta. T+10 última llamada; sin contacto → ILOCALIZABLE.',
      isActive: true,
      isDefault: true,
      steps: { create: stepsCreate },
    },
    include: { steps: { orderBy: { order: 'asc' } } },
  });

  console.log(`Secuencia Toni creada: ${sequence.id}`);
  for (const step of sequence.steps) {
    console.log(
      `  Paso ${step.order}: ${step.channel} @ ${step.delayMinutes} min (${step.templateKey})`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
