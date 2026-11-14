import {
  classifyOwnerReplyHeuristic,
  parseOwnerReplyLlmJson,
} from './owner-reply-classifier';

describe('owner-reply-classifier', () => {
  it('NO_CONTACTAR', () => {
    expect(classifyOwnerReplyHeuristic('No me llaméis más ni me escribáis').intent).toBe(
      'NO_CONTACTAR',
    );
  });

  it('NO_DISPONIBLE', () => {
    expect(classifyOwnerReplyHeuristic('El local ya está vendido').intent).toBe(
      'NO_DISPONIBLE',
    );
    expect(
      classifyOwnerReplyHeuristic('Lo tenemos alquilado, no disponible').intent,
    ).toBe('NO_DISPONIBLE');
  });

  it('NO_INTERESADO', () => {
    expect(
      classifyOwnerReplyHeuristic('No me interesa publicar con vosotros').intent,
    ).toBe('NO_INTERESADO');
  });

  it('DISPONIBLE', () => {
    expect(
      classifyOwnerReplyHeuristic('Sí, sigue disponible el local').intent,
    ).toBe('DISPONIBLE');
  });

  it('AMBIGUO', () => {
    expect(classifyOwnerReplyHeuristic('Hola, ¿quiénes sois?').intent).toBe(
      'AMBIGUO',
    );
  });

  it('parsea JSON del LLM', () => {
    const parsed = parseOwnerReplyLlmJson(
      '```json\n{"intent":"DISPONIBLE","confidence":0.91,"reason":"ok","motive":"sigue libre"}\n```',
    );
    expect(parsed?.intent).toBe('DISPONIBLE');
    expect(parsed?.confidence).toBeCloseTo(0.91);
  });
});
