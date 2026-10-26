import { handleAgendarLlamada } from './agendar-llamada';
import { madridWallToUtc } from '../v2/calendar-slots';

describe('handleAgendarLlamada', () => {
  const now = new Date('2026-10-21T06:00:00.000Z');
  const slot = {
    inicioIso: '2026-10-21T10:30:00+02:00',
    etiqueta: 'miércoles 21 de octubre a las 10:30',
    startMs: madridWallToUtc(2026, 10, 21, 10, 30).getTime(),
  };

  it('consulta huecos y no marca la cita como reservada', async () => {
    const result = await handleAgendarLlamada(
      { args: { accion: 'consultar' }, call: { to_number: '+34600000000' } },
      {
        listSlots: async () => [slot],
        bookCall: async () => ({ ok: true }),
      },
      now,
    );
    expect(result.reservada).toBe(false);
    expect(result.huecos).toEqual([
      { inicio_iso: slot.inicioIso, etiqueta: slot.etiqueta },
    ]);
  });

  it('reserva el inicio_iso y usa el teléfono de quien llama si es inbound', async () => {
    const booked = jest.fn(async () => ({
      ok: true,
      etiqueta: slot.etiqueta,
    }));
    const result = await handleAgendarLlamada(
      {
        args: { accion: 'reservar', inicio_iso: slot.inicioIso, nombre: 'Ana' },
        call: { direction: 'inbound', from_number: '+34611111111' },
      },
      { listSlots: async () => [], bookCall: booked },
      now,
    );
    expect(result.reservada).toBe(true);
    expect(booked).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+34611111111',
        nombre: 'Ana',
        start: new Date(slot.inicioIso),
      }),
    );
  });

  it('no confirma una hora inventada', async () => {
    const result = await handleAgendarLlamada(
      { args: { accion: 'reservar', inicio_iso: 'cuando pueda' } },
      {
        listSlots: async () => [],
        bookCall: async () => ({ ok: true }),
      },
      now,
    );
    expect(result.reservada).toBe(false);
    expect(result.ok).toBe(false);
  });
});
