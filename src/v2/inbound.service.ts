import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { LOCALISTO_INBOUND_PROMPT } from './prompts';
import axios from 'axios';
import { CalendarService } from './calendar.service';
import twilio from 'twilio';
import { Twilio } from 'twilio';
import { WordpressService } from '../wordpress/wordpress.service';
import { SheetsService } from '../sheets/sheets.service';

export enum UserState {
  INDETERMINATE = 'INDETERMINATE',
  BUSCADOR = 'BUSCADOR',
  PROPIETARIO = 'PROPIETARIO',
  INVERSOR = 'INVERSOR',
  AGENDANDO = 'AGENDANDO',
  CITA_AGENDADA = 'CITA_AGENDADA',
}

export interface UserEntities {
  nombre_usuario?: string;
  tipo_negocio?: string;
  ubicacion?: string;
  presupuesto_max?: number;
  operacion?: 'Alquiler' | 'Venta';
  appointment_slot?: string;
}

@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);
  private readonly openai: OpenAI;
  private readonly twilioClient: Twilio;
  
  private chatHistory = new Map<string, any[]>();
  private userStates = new Map<string, UserState>();
  private userEntities = new Map<string, UserEntities>();

  constructor(
    private configService: ConfigService,
    private calendarService: CalendarService,
    private sheetsService: SheetsService,
    private wordpressService: WordpressService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });
    this.twilioClient = twilio(
      this.configService.get('TWILIO_ACCOUNT_SID'),
      this.configService.get('TWILIO_AUTH_TOKEN'),
    );
  }

  async handleIncomingMessage(from: string, message: string): Promise<string> {
    this.logger.log(`Mensaje recibido de ${from}: ${message}`);

    let state = this.userStates.get(from) || UserState.INDETERMINATE;
    let history = this.chatHistory.get(from) || [];
    let entities = this.userEntities.get(from) || {};

    let calendarContext = '';
    if (state === UserState.AGENDANDO || message.toLowerCase().includes('visita') || message.toLowerCase().includes('agendar')) {
      const slots = await this.calendarService.getAvailableSlots();
      calendarContext = `\nHUECOS DISPONIBLES EN CALENDARIO: ${slots.join(', ')}`;
    }

    const systemPrompt = `
${LOCALISTO_INBOUND_PROMPT}
ESTADO ACTUAL DEL USUARIO: ${state}
DATOS EXTRAÍDOS HASTA AHORA: ${JSON.stringify(entities)}${calendarContext}

INSTRUCCIONES DE BÚSQUEDA Y RESULTADOS:
1. Si se encuentran locales: Presenta máximo 2 o 3 de forma muy breve: "Nombre - Precio - [Link]". PREGUNTA SI QUIEREN AGENDAR UNA VISITA.
2. Si NO hay resultados (0 locales): Ofrece proactivamente nuestro "Servicio de Scouting". Explica que buscamos locales que no están en portales y usamos nuestra App colaborativa para encontrar oportunidades "off-market".
3. Si la búsqueda falla (error técnico): Pide disculpas y ofrece que Toni (nuestro experto) contacte con ellos personalmente. Pregunta cuál sería el mejor horario para una breve llamada.

INSTRUCCIONES DE AGENDADO:
- Si el usuario quiere agendar, propón los huecos disponibles.
- Usa 'confirm_appointment' cuando el usuario elija un horario.

REGLAS DE IDENTIDAD:
- Solo una pregunta por mensaje. Respuestas cortas. Tono humano y cercano.
`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: message },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_entities',
              description: 'Extrae entidades de búsqueda.',
              parameters: {
                type: 'object',
                properties: {
                  nombre_usuario: { type: 'string', description: 'Nombre real del usuario si lo menciona.' },
                  tipo_negocio: { type: 'string' },
                  ubicacion: { type: 'string' },
                  presupuesto_max: { type: 'number' },
                  operacion: { type: 'string', enum: ['Alquiler', 'Venta'] },
                  nuevo_estado: { type: 'string', enum: Object.values(UserState) },
                },
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'confirm_appointment',
              description: 'Reserva una visita.',
              parameters: {
                type: 'object',
                properties: {
                  slot: { type: 'string' },
                },
                required: ['slot'],
              },
            },
          }
        ],
        tool_choice: 'auto',
      });

      const responseMessage = response.choices[0].message;

      if (responseMessage.tool_calls) {
        let toolResults: any[] = [];
        for (const toolCall of responseMessage.tool_calls) {
          if ('function' in toolCall) {
            const args = JSON.parse(toolCall.function.arguments);
            
            if (toolCall.function.name === 'extract_entities') {
              if (['vivienda', 'piso', 'casa'].includes(args.tipo_negocio?.toLowerCase())) {
                return 'En Localicer nos especializamos exclusivamente en el sector comercial. No gestionamos viviendas, pero si buscas un local para tu negocio, ¡estoy aquí!';
              }
              entities = { ...entities, ...args };
              this.userEntities.set(from, entities);
              if (args.nuevo_estado) {
                state = args.nuevo_estado;
                this.userStates.set(from, state);
              }
            toolResults.push({ role: 'tool', tool_call_id: toolCall.id, content: 'OK' });
            
            // Registro automático de Lead en CRM (Sheets)
            await this.sheetsService.addLead({ from, entities, state });
          }

          if (toolCall.function.name === 'confirm_appointment') {
            await this.calendarService.bookAppointment(from, args.slot, `Visita: ${entities.tipo_negocio} en ${entities.ubicacion}`);
            this.userStates.set(from, UserState.CITA_AGENDADA);
            entities.appointment_slot = args.slot;
            this.userEntities.set(from, entities);
            toolResults.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Cita agendada.' });
            
            // Registro de cita en CRM
            await this.sheetsService.addLead({ 
              from, 
              entities, 
              state: UserState.CITA_AGENDADA,
              summary: `Cita confirmada para el ${args.slot}` 
            });

            // Notificación proactiva Twilio (Opcional, la respuesta final ya confirma)
            this.sendProactiveConfirmation(from, args.slot);
          }
          }
        }

        let searchContext = '';
        if (state === UserState.BUSCADOR && entities.tipo_negocio && entities.ubicacion) {
          try {
            const results = await this.wordpressService.searchProperties({ 
              type: entities.tipo_negocio, 
              zone: entities.ubicacion, 
              budget: entities.presupuesto_max 
            });
            searchContext = results.length > 0 ? `\nRESULTADOS: ${JSON.stringify(results)}` : '\nRESULTADOS: 0';
          } catch (e) {
            searchContext = '\nRESULTADOS: ERROR_TECNICO';
          }
        }

        const secondResponse = await this.openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: `${systemPrompt}${searchContext}` },
            ...history,
            { role: 'user', content: message },
            responseMessage,
            ...toolResults as any,
          ],
        });
        
        const reply = secondResponse.choices[0].message.content || 'Entendido.';
        this.updateHistoryAndState(from, message, reply, history);
        return reply;
      }

      const reply = responseMessage.content || 'Dime más.';
      this.updateHistoryAndState(from, message, reply, history);
      return reply;

    } catch (error) {
      this.logger.error(`Error: ${error.message}`);
      return 'Lo siento, hubo un error técnico. ¿Podemos intentarlo de nuevo?';
    }
  }

  private async sendProactiveConfirmation(to: string, slot: string) {
    try {
      await this.twilioClient.messages.create({
        from: this.configService.get('TWILIO_WHATSAPP_NUMBER'),
        to: to,
        body: `✅ ¡Cita Confirmada! Hemos agendado tu visita para el ${slot}. Toni ya ha sido notificado y te estará esperando. ¡Nos vemos pronto!`,
      });
    } catch (e) {
      this.logger.error(`Error enviando confirmación proactiva: ${e.message}`);
    }
  }

  private updateHistoryAndState(from: string, userMsg: string, aiReply: string, history: any[]) {
    history.push({ role: 'user', content: userMsg });
    history.push({ role: 'assistant', content: aiReply });
    if (history.length > 10) history = history.slice(-10);
    this.chatHistory.set(from, history);
    this.detectStateChange(from, aiReply);
  }

  private detectStateChange(from: string, aiReply: string) {
    const text = aiReply.toLowerCase();
    if (text.includes('visita') || text.includes('agendar')) this.userStates.set(from, UserState.AGENDANDO);
    if (text.includes('confirmado') && text.includes('cita')) this.userStates.set(from, UserState.CITA_AGENDADA);
  }
}
