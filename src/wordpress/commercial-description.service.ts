import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { sanitizeValue, type RetellCad } from './property-mapper';
import {
  buildFallbackCommercialDescription,
  looksLikeTechnicalDump,
  pickExistingCommercialDescription,
} from './commercial-description';

const SYSTEM_PROMPT = `Eres un asesor inmobiliario experto en locales, naves y oficinas en España (Localicer).
Redacta el texto comercial que irá en "Comentario del anunciante" / "Descripción por el propietario" de WPResidence.

Reglas:
- Tono profesional, cercano y persuasivo. Español de España.
- 2 a 4 párrafos en HTML simple: solo <p> y <strong>. Sin listas de ficha técnica.
- NO vuelques precio, m², baños, plantas ni certificaciones en forma de listado: esos datos viven en campos nativos.
- Sí puedes mencionar de forma narrativa la ubicación, el tipo de inmueble, el uso previo y el potencial del espacio.
- No inventes datos que no estén en el JSON. No firmes como Localisto IA ni pongas Call ID.
- Empieza con un gancho comercial (oportunidad, zona, tipo de negocio).`;

@Injectable()
export class CommercialDescriptionService {
  private readonly logger = new Logger(CommercialDescriptionService.name);
  private readonly openai: OpenAI | null;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
    this.model =
      this.config.get<string>('OPENAI_PROPERTY_MODEL') || 'gpt-4o-mini';
  }

  /**
   * Descripción comercial para post_content / columna Sheet.
   * Reutiliza texto ya validado; si es ficha técnica o está vacío, genera uno nuevo.
   */
  async resolve(
    cad: RetellCad | undefined,
    callSummary?: string,
  ): Promise<string> {
    const existing = pickExistingCommercialDescription(cad);
    if (existing) return existing;

    const generated = await this.generate(cad, callSummary);
    return generated || buildFallbackCommercialDescription(cad, callSummary);
  }

  async generate(
    cad: RetellCad | undefined,
    callSummary?: string,
  ): Promise<string> {
    if (!this.openai) {
      return buildFallbackCommercialDescription(cad, callSummary);
    }

    try {
      const completion = await Promise.race([
        this.openai.chat.completions.create({
          model: this.model,
          temperature: 0.6,
          max_tokens: 700,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: JSON.stringify(
                {
                  call_summary: sanitizeValue(callSummary) || undefined,
                  inmueble: cad || {},
                },
                null,
                2,
              ),
            },
          ],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout descripción comercial')), 12000),
        ),
      ]);

      const text = completion.choices[0]?.message?.content?.trim() || '';
      if (!text || looksLikeTechnicalDump(text)) {
        return buildFallbackCommercialDescription(cad, callSummary);
      }
      return text;
    } catch (err) {
      this.logger.warn(
        `No se pudo generar descripción IA: ${err instanceof Error ? err.message : err}`,
      );
      return buildFallbackCommercialDescription(cad, callSummary);
    }
  }
}
