import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel as PrismaChannel, Prisma } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../../prisma/prisma.service';
import { SheetsService } from '../../sheets/sheets.service';
import { findDisponibilidadHeader } from '../../sheets/sheet-operation-headers';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { phoneDedupeKey } from '../utils/phone.util';
import {
  OWNER_REPLY_LLM_SYSTEM,
  classifyOwnerReplyHeuristic,
  parseOwnerReplyLlmJson,
} from './owner-reply-classifier';
import {
  buildOwnerResolveResult,
  matchSheetRowsByPhone,
  normalizeInboundWhatsappPhone,
} from './owner-reply-resolve';
import type {
  OwnerReplyActionResult,
  OwnerReplyClassifyResult,
  OwnerReplyIntent,
  OwnerResolveResult,
} from './owner-reply.types';

@Injectable()
export class OwnerReplyService {
  private readonly logger = new Logger(OwnerReplyService.name);
  private openai: OpenAI | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsService,
    private readonly enrollments: EnrollmentsService,
  ) {
    const key = this.config.get<string>('OPENAI_API_KEY');
    if (key) this.openai = new OpenAI({ apiKey: key });
  }

  isDryRun(): boolean {
    const v = String(this.config.get('OWNER_REPLY_DRY_RUN') ?? '')
      .trim()
      .toLowerCase();
    return v === 'true' || v === '1' || v === 'yes' || v === 'si' || v === 'sí';
  }

  usesHeuristicClassifier(): boolean {
    const mode = String(this.config.get('OWNER_REPLY_CLASSIFIER') ?? '')
      .trim()
      .toLowerCase();
    if (mode === 'heuristic' || mode === 'local') return true;
    if (mode === 'llm' || mode === 'openai') return false;
    // Default: heuristic si no hay OpenAI o dry-run local
    return !this.openai || this.isDryRun();
  }

  async resolveAdvertiser(fromRaw: string): Promise<OwnerResolveResult> {
    const e164 = normalizeInboundWhatsappPhone(fromRaw);
    const digits = phoneDedupeKey(e164).slice(-9);

    const leads = await this.prisma.lead.findMany({
      where: {
        OR: [
          { phone: e164 },
          ...(digits ? [{ phone: { contains: digits } }] : []),
        ],
      },
      select: { id: true, phone: true },
      take: 20,
    });

    const { rows } = await this.sheets.getAllRows('Localizados');
    const sheetRows = matchSheetRowsByPhone(rows, e164);

    return buildOwnerResolveResult({
      e164,
      leadIds: [...new Set(leads.map((l) => l.id))],
      sheetRows,
    });
  }

  async classify(message: string): Promise<OwnerReplyClassifyResult> {
    if (this.usesHeuristicClassifier()) {
      return classifyOwnerReplyHeuristic(message);
    }
    try {
      const completion = await this.openai!.chat.completions.create({
        model: this.config.get('OWNER_REPLY_OPENAI_MODEL') || 'gpt-4o-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: OWNER_REPLY_LLM_SYSTEM },
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
      });
      const raw = completion.choices[0]?.message?.content || '';
      const parsed = parseOwnerReplyLlmJson(raw);
      if (parsed) return parsed;
      this.logger.warn(
        `[OwnerReply] LLM JSON inválido — fallback heurístico: ${raw.slice(0, 200)}`,
      );
    } catch (err) {
      this.logger.warn(
        `[OwnerReply] LLM falló — fallback heurístico: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    return classifyOwnerReplyHeuristic(message);
  }

  /**
   * Flujo completo anunciante. No llama a Localisto.
   */
  async handleAdvertiserMessage(params: {
    from: string;
    body: string;
    /** Fuerza dry-run (scripts de prueba). */
    forceDryRun?: boolean;
  }): Promise<OwnerReplyActionResult> {
    const dryRun = params.forceDryRun === true || this.isDryRun();
    const resolved = await this.resolveAdvertiser(params.from);
    if (!resolved.isAdvertiser) {
      throw new Error('not_advertiser');
    }

    const classified = await this.classify(params.body);
    let intent = classified.intent;
    const actions: string[] = [];

    if (resolved.ambiguous && intent !== 'NO_CONTACTAR') {
      // Ambigüedad de anuncio: no tocar datos críticos salvo opt-out global.
      intent = 'AMBIGUO';
      actions.push('ambiguous_multi_listing');
    }

    const leadIds = [...resolved.leadIds];
    if (leadIds.length === 0 && !dryRun) {
      const created = await this.prisma.lead.create({
        data: {
          phone: resolved.e164,
          source: 'whatsapp_inbound_owner',
          metadata: {
            created_from: 'owner_reply',
          } as Prisma.InputJsonValue,
        },
      });
      leadIds.push(created.id);
      actions.push(`lead_created:${created.id}`);
    }

    if (!dryRun) {
      await this.applyIntentActions({
        intent,
        motive: classified.motive || classified.reason,
        resolved: { ...resolved, leadIds },
        actions,
      });
    } else {
      actions.push(`dry_run_skip_writes:${intent}`);
      if (resolved.sheetRows.length === 1) {
        actions.push(`would_update_sheet_row:${resolved.sheetRows[0].rowNumber}`);
      }
      for (const id of leadIds) {
        actions.push(`would_touch_lead:${id}`);
      }
    }

    for (const leadId of leadIds.length ? leadIds : resolved.leadIds) {
      await this.auditInbound({
        leadId,
        intent,
        body: params.body,
        actions,
        dryRun,
        providerRef: resolved.e164,
      });
    }
    if (leadIds.length === 0 && resolved.leadIds.length === 0) {
      // Sin lead en dry-run: log solo
      this.logger.log(
        `[OwnerReply] audit sin lead dryRun=${dryRun} intent=${intent} from=${resolved.e164}`,
      );
    }

    const reply = this.buildReply(intent, resolved.ambiguous);
    this.logger.log(
      `[OwnerReply] from=${resolved.e164} intent=${intent} dryRun=${dryRun} actions=${actions.join('|')}`,
    );

    return {
      intent,
      reply,
      dryRun,
      actions,
      sheetRowNumbers: resolved.sheetRows.map((r) => r.rowNumber),
      leadIds,
      ambiguous: resolved.ambiguous || intent === 'AMBIGUO',
    };
  }

  private async applyIntentActions(params: {
    intent: OwnerReplyIntent;
    motive: string;
    resolved: OwnerResolveResult;
    actions: string[];
  }): Promise<void> {
    const { intent, motive, resolved, actions } = params;
    const row =
      resolved.sheetRows.length === 1 ? resolved.sheetRows[0] : null;

    switch (intent) {
      case 'NO_DISPONIBLE': {
        if (row) {
          await this.writeDisponibilidad(row.rowNumber, 'NO', motive);
          actions.push(`sheet_disponibilidad_NO:${row.rowNumber}`);
        }
        for (const leadId of resolved.leadIds) {
          await this.patchLeadMeta(leadId, {
            owner_reply_intent: intent,
            owner_reply_motive: motive,
            disponibilidad: 'NO',
          });
          const stopped = await this.enrollments.stopActiveForLead(
            leadId,
            `owner_reply:${intent}`,
          );
          actions.push(`stop_enrollments:${leadId}:${stopped}`);
        }
        break;
      }
      case 'DISPONIBLE': {
        if (row) {
          await this.writeDisponibilidad(row.rowNumber, 'SI', motive);
          actions.push(`sheet_disponibilidad_SI:${row.rowNumber}`);
        }
        for (const leadId of resolved.leadIds) {
          await this.patchLeadMeta(leadId, {
            owner_reply_intent: intent,
            owner_reply_motive: motive,
            disponibilidad: 'SI',
          });
          actions.push(`lead_meta_disponible:${leadId}`);
        }
        break;
      }
      case 'NO_INTERESADO': {
        for (const leadId of resolved.leadIds) {
          await this.patchLeadMeta(leadId, {
            owner_reply_intent: intent,
            commercial_rejection: true,
            commercial_rejection_reason: motive,
            no_interesado: true,
          });
          const stopped = await this.enrollments.stopActiveForLead(
            leadId,
            `owner_reply:${intent}`,
          );
          actions.push(`commercial_rejection:${leadId}:stopped=${stopped}`);
        }
        break;
      }
      case 'NO_CONTACTAR': {
        for (const leadId of resolved.leadIds) {
          await this.patchLeadMeta(leadId, {
            doNotContact: true,
            owner_reply_intent: intent,
            owner_reply_motive: motive,
            opt_out_at: new Date().toISOString(),
          });
          const stopped = await this.enrollments.stopActiveForLead(
            leadId,
            `owner_reply:${intent}`,
          );
          actions.push(`doNotContact:${leadId}:stopped=${stopped}`);
        }
        break;
      }
      case 'AMBIGUO':
      default: {
        for (const leadId of resolved.leadIds) {
          await this.patchLeadMeta(leadId, {
            owner_reply_last_ambiguous_at: new Date().toISOString(),
            owner_reply_last_message: motive,
          });
        }
        actions.push('ambiguous_no_critical_writes');
        break;
      }
    }
  }

  private async writeDisponibilidad(
    rowNumber: number,
    value: 'SI' | 'NO',
    motive: string,
  ): Promise<void> {
    const { sheet } = await this.sheets.getAllRows('Localizados');
    const headers = sheet.headerValues || [];
    const header = findDisponibilidadHeader(headers) || 'Disponibilidad';
    const updates: Record<string, string> = {
      [header]: value,
    };
    // Motivo opcional si existe columna
    const motiveHeader = headers.find((h) =>
      /motivo.*disponib|disponib.*motivo|notas?\s*disponib/i.test(h),
    );
    if (motiveHeader) {
      updates[motiveHeader] = motive.slice(0, 200);
    }
    await this.sheets.updateSpecificCells(sheet, rowNumber, updates);
  }

  private async patchLeadMeta(
    leadId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;
    const meta = {
      ...((lead.metadata as Record<string, unknown> | null) || {}),
      ...patch,
    };
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { metadata: meta as Prisma.InputJsonValue },
    });
  }

  private async auditInbound(params: {
    leadId: string;
    intent: OwnerReplyIntent;
    body: string;
    actions: string[];
    dryRun: boolean;
    providerRef: string;
  }): Promise<void> {
    if (params.dryRun) {
      this.logger.log(
        `[OwnerReply][AUDIT dry-run] lead=${params.leadId} intent=${params.intent} actions=${params.actions.join(',')}`,
      );
      return;
    }
    await this.prisma.communicationLog.create({
      data: {
        leadId: params.leadId,
        channel: PrismaChannel.whatsapp,
        direction: 'inbound',
        summary: `owner_reply:${params.intent}:${params.actions.slice(0, 5).join(',')}`,
        providerRef: params.providerRef,
      },
    });
  }

  private buildReply(intent: OwnerReplyIntent, ambiguous: boolean): string {
    if (ambiguous || intent === 'AMBIGUO') {
      return 'Gracias por tu mensaje. Para no equivocarnos con el anuncio, ¿puedes indicarnos la dirección o referencia del local al que te refieres?';
    }
    switch (intent) {
      case 'NO_DISPONIBLE':
        return 'Entendido, marcamos el inmueble como no disponible y cancelamos los seguimientos. Gracias por avisar.';
      case 'DISPONIBLE':
        return 'Perfecto, confirmamos que sigue disponible. Si necesitamos algún dato más te escribimos. ¡Gracias!';
      case 'NO_INTERESADO':
        return 'De acuerdo, registramos que no te interesa el servicio y detenemos los seguimientos comerciales. Gracias.';
      case 'NO_CONTACTAR':
        return 'Queda registrado: no te volveremos a llamar ni escribir. Gracias.';
      default:
        return 'Gracias por tu mensaje. Lo revisamos y te confirmamos.';
    }
  }
}
