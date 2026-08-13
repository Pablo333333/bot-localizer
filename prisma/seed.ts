import { Channel, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_SEQUENCE_NAME = 'Seguimiento Toni (Call → WA → Call 7d)';

/**
 * Secuencia Fase 3 según Toni (sin email intermedio):
 * 1) Llamada outbound inmediata
 * 2) WhatsApp inmediato (link de agendamiento — ideal tras no-contesta)
 * 3) Llamada a los 7 días
 * SMS queda preparado como canal (fallback), no en la secuencia default.
 */
async function main() {
  const bookingPlaceholder =
    process.env.BOOKING_LINK ||
    process.env.CALENDAR_BOOKING_URL ||
    'https://www.localicer.com/agendar';

  // Desactivar defaults anteriores (WA → Email 3d → Call)
  await prisma.sequence.updateMany({
    where: { isDefault: true },
    data: { isDefault: false, isActive: false },
  });

  const existingToni = await prisma.sequence.findFirst({
    where: { name: DEFAULT_SEQUENCE_NAME },
    include: { steps: true },
  });

  if (existingToni) {
    await prisma.sequence.update({
      where: { id: existingToni.id },
      data: { isDefault: true, isActive: true },
    });
    console.log(`Secuencia Toni ya existía, reactivada: ${existingToni.id}`);
    return;
  }

  const sequence = await prisma.sequence.create({
    data: {
      name: DEFAULT_SEQUENCE_NAME,
      description:
        'Paso 1: Llamada outbound → Paso 2: WhatsApp inmediato (link Calendar) → Paso 3: Llamada a los 7 días. Sin email intermedio.',
      isActive: true,
      isDefault: true,
      steps: {
        create: [
          {
            order: 1,
            channel: Channel.llamada,
            delayMinutes: 0,
            templateKey: 'nurturing.call.outbound_d0',
            templatePayload: {
              summary: 'Llamada outbound de seguimiento / captación',
            },
            maxRetries: 2,
          },
          {
            order: 2,
            channel: Channel.whatsapp,
            delayMinutes: 0,
            templateKey: 'nurturing.whatsapp.booking_link',
            templatePayload: {
              body:
                'Hola {{name}}, no hemos podido hablar por teléfono. ' +
                'Puedes agendar una visita aquí: {{booking_link}} ' +
                '— Localicer',
              booking_link: bookingPlaceholder,
            },
            maxRetries: 3,
          },
          {
            order: 3,
            channel: Channel.llamada,
            delayMinutes: 10080, // 7 días
            templateKey: 'nurturing.call.followup_d7',
            templatePayload: {
              summary: 'Segunda llamada de seguimiento (día 7)',
            },
            maxRetries: 2,
          },
        ],
      },
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
