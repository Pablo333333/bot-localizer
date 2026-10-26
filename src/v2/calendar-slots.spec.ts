import {
  formatMadridOffsetIso,
  listFreeSlots,
  madridWallToUtc,
  parseSlotInput,
} from './calendar-slots';

describe('calendar-slots', () => {
  it('convierte las 10:00 de Madrid a UTC en horario de verano y de invierno', () => {
    expect(madridWallToUtc(2026, 10, 21, 10, 0).toISOString()).toBe(
      '2026-10-21T08:00:00.000Z',
    );
    expect(madridWallToUtc(2026, 10, 26, 10, 0).toISOString()).toBe(
      '2026-10-26T09:00:00.000Z',
    );
  });

  it('ofrece huecos de 30 minutos entre semana, con dos horas de margen', () => {
    const now = new Date('2026-10-21T06:00:00.000Z');
    const slots = listFreeSlots({
      now,
      busy: [
        {
          startMs: madridWallToUtc(2026, 10, 21, 10, 0).getTime(),
          endMs: madridWallToUtc(2026, 10, 21, 10, 30).getTime(),
        },
      ],
    });
    expect(slots).toHaveLength(6);
    expect(slots[0].etiqueta).toContain('10:30');
    expect(slots[0].inicioIso).toBe(
      formatMadridOffsetIso(madridWallToUtc(2026, 10, 21, 10, 30)),
    );
    expect(slots.some((slot) => slot.etiqueta.includes('sábado'))).toBe(false);
  });

  it('interpreta el iso devuelto y frases en español', () => {
    const now = new Date('2026-10-21T06:00:00.000Z');
    const iso = formatMadridOffsetIso(madridWallToUtc(2026, 10, 22, 11, 0));
    expect(parseSlotInput(iso, now)?.toISOString()).toBe(
      '2026-10-22T09:00:00.000Z',
    );
    expect(parseSlotInput('22/10/2026 a las 11:00', now)?.toISOString()).toBe(
      '2026-10-22T09:00:00.000Z',
    );
    expect(parseSlotInput('mañana a las 11:00', now)?.toISOString()).toBe(
      '2026-10-22T09:00:00.000Z',
    );
    expect(parseSlotInput('cuando pueda', now)).toBeNull();
  });
});
