import {
  isWithinBookingWindow,
  MIN_LEAD_MS,
  parseSlotInput,
  type CalendarSlot,
} from '../v2/calendar-slots';

export type BookedCall = {
  ok: boolean;
  etiqueta?: string;
  error?: string;
};

export type AgendarCalendar = {
  listSlots(now: Date): Promise<CalendarSlot[]>;
  bookCall(input: {
    start: Date;
    phone: string;
    nombre?: string;
    motivo?: string;
    now: Date;
  }): Promise<BookedCall>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function phoneFromRetellCall(body: unknown): string {
  const call = asRecord(asRecord(body).call);
  const direction = text(call.direction);
  const from = text(call.from_number);
  const to = text(call.to_number);
  if (direction === 'inbound') return from || to;
  return to || from;
}

/**
 * Cuerpo que Retell envía al ejecutar la custom function AGENDAR_LLAMADA.
 * `accion=consultar` devuelve huecos reales. `accion=reservar` escribe el evento.
 */
export async function handleAgendarLlamada(
  body: unknown,
  calendar: AgendarCalendar,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const root = asRecord(body);
  const args = Object.keys(asRecord(root.args)).length
    ? asRecord(root.args)
    : root;
  const accion = text(args.accion || args.action).toLowerCase();
  const phone = phoneFromRetellCall(body);

  if (accion !== 'consultar' && accion !== 'reservar') {
    return {
      ok: false,
      reservada: false,
      error:
        'Indica accion "consultar" para ver huecos o "reservar" para confirmar uno.',
    };
  }

  if (accion === 'consultar') {
    const huecos = await calendar.listSlots(now);
    if (huecos.length === 0) {
      return {
        ok: true,
        accion,
        reservada: false,
        huecos: [],
        mensaje:
          'No hay huecos libres en los próximos días laborables. No inventes una hora.',
      };
    }
    return {
      ok: true,
      accion,
      reservada: false,
      huecos: huecos.map((slot) => ({
        inicio_iso: slot.inicioIso,
        etiqueta: slot.etiqueta,
      })),
      mensaje:
        'Ofrece como máximo dos etiquetas. Para reservar, reenvía el inicio_iso tal cual.',
    };
  }

  const inicio = text(args.inicio_iso || args.inicioIso || args.slot);
  const start = parseSlotInput(inicio, now);
  if (!start) {
    return {
      ok: false,
      accion,
      reservada: false,
      error:
        'Falta un inicio_iso válido. Vuelve a consultar y copia el inicio_iso del hueco elegido.',
    };
  }
  if (
    start.getTime() < now.getTime() + MIN_LEAD_MS ||
    !isWithinBookingWindow(start)
  ) {
    return {
      ok: false,
      accion,
      reservada: false,
      error:
        'Ese hueco no se puede reservar. Consulta de nuevo y elige otro inicio_iso.',
    };
  }

  const booked = await calendar.bookCall({
    start,
    phone,
    nombre: text(args.nombre || args.name) || undefined,
    motivo: text(args.motivo || args.notes) || undefined,
    now,
  });
  if (!booked.ok) {
    return {
      ok: false,
      accion,
      reservada: false,
      error: booked.error || 'No se pudo registrar la cita. Consulta de nuevo.',
    };
  }
  return {
    ok: true,
    accion,
    reservada: true,
    etiqueta: booked.etiqueta,
    mensaje: 'Cita registrada. Confirma la etiqueta y despídete.',
  };
}
