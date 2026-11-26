import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import Retell from 'retell-sdk';

type RawBodyRequest = Request & { rawBody?: Buffer | string };

/**
 * Auth para POST /webhooks/retell* (Sheets + AGENDAR_LLAMADA).
 *
 * Métodos aceptados (basta con que uno sea válido):
 * 1. Firma oficial de Retell en cabecera `x-retell-signature`, verificada con
 *    `Retell.verify(rawBody, RETELL_API_KEY, signature)` usando `rawBody: true`.
 * 2. Secreto compartido (`RETELL_WEBHOOK_SECRET` o, compat, `RETELL_TOOL_SECRET`)
 *    en una de estas cabeceras:
 *    `x-localicer-tool-key` | `x-retell-webhook-secret` | `x-api-key` | `Authorization: Bearer`.
 */
@Injectable()
export class RetellWebhookGuard implements CanActivate {
  private readonly logger = new Logger(RetellWebhookGuard.name);

  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const apiKey = this.resolveRetellApiKey();
    const expectedSecret = this.resolveExpectedSecret();

    if (!apiKey && !expectedSecret) {
      this.logger.error(
        'RETELL_API_KEY y RETELL_WEBHOOK_SECRET no configurados — se rechazan webhooks Retell',
      );
      throw new UnauthorizedException(
        'Retell webhook authentication is not configured',
      );
    }

    const request = context.switchToHttp().getRequest<RawBodyRequest>();

    if (expectedSecret) {
      const provided = this.extractProvidedSecret(request);
      if (provided && this.safeEquals(provided, expectedSecret)) {
        return true;
      }
    }

    if (apiKey) {
      const signature = this.extractRetellSignature(request);
      if (
        signature &&
        (await this.verifyRetellSignature(request, apiKey, signature))
      ) {
        return true;
      }
    }

    this.logger.warn(
      `Webhook Retell no autorizado path=${request.path || request.url} hasSig=${Boolean(this.extractRetellSignature(request))} hasSecret=${Boolean(this.extractProvidedSecret(request))}`,
    );
    throw new UnauthorizedException('Invalid Retell webhook signature or secret');
  }

  private resolveRetellApiKey(): string {
    return String(this.config.get('RETELL_API_KEY') ?? '').trim();
  }

  private resolveExpectedSecret(): string {
    const primary = String(
      this.config.get('RETELL_WEBHOOK_SECRET') ?? '',
    ).trim();
    if (primary) return primary;
    return String(this.config.get('RETELL_TOOL_SECRET') ?? '').trim();
  }

  private extractRetellSignature(request: RawBodyRequest): string | undefined {
    const raw = request.headers['x-retell-signature'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private async verifyRetellSignature(
    request: RawBodyRequest,
    apiKey: string,
    signature: string,
  ): Promise<boolean> {
    const rawBody = this.resolveRawBody(request);
    if (!rawBody) return false;
    try {
      return Boolean(await Retell.verify(rawBody, apiKey, signature));
    } catch {
      return false;
    }
  }

  private resolveRawBody(request: RawBodyRequest): string {
    if (Buffer.isBuffer(request.rawBody)) {
      return request.rawBody.toString('utf8');
    }
    if (typeof request.rawBody === 'string') {
      return request.rawBody;
    }
    if (request.body !== undefined) {
      return JSON.stringify(request.body);
    }
    return '';
  }

  private safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  private extractProvidedSecret(request: RawBodyRequest): string | undefined {
    const headers = request.headers;
    const candidates = [
      headers['x-localicer-tool-key'],
      headers['x-retell-webhook-secret'],
      headers['x-api-key'],
      this.bearerToken(
        typeof headers.authorization === 'string'
          ? headers.authorization
          : undefined,
      ),
    ];
    for (const raw of candidates) {
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private bearerToken(authorization?: string): string | undefined {
    if (!authorization?.startsWith('Bearer ')) return undefined;
    return authorization.slice(7).trim();
  }
}
