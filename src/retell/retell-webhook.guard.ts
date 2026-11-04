import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Auth para POST /webhooks/retell* (Sheets + AGENDAR_LLAMADA).
 *
 * Secreto (obligatorio): RETELL_WEBHOOK_SECRET o, compat, RETELL_TOOL_SECRET.
 * Cabeceras aceptadas (primera que coincida):
 *   x-localicer-tool-key | x-retell-webhook-secret | x-api-key | Authorization: Bearer
 *
 * En el dashboard de Retell, configura el mismo valor como custom header
 * hacia el endpoint público.
 */
@Injectable()
export class RetellWebhookGuard implements CanActivate {
  private readonly logger = new Logger(RetellWebhookGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.resolveExpectedSecret();
    if (!expected) {
      this.logger.error(
        'RETELL_WEBHOOK_SECRET / RETELL_TOOL_SECRET no configurado — se rechazan webhooks Retell',
      );
      throw new UnauthorizedException(
        'Retell webhook secret is not configured',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = this.extractProvidedSecret(request);

    if (!provided || provided !== expected) {
      this.logger.warn(
        `Webhook Retell no autorizado path=${request.path || request.url}`,
      );
      throw new UnauthorizedException('Invalid Retell webhook secret');
    }

    return true;
  }

  private resolveExpectedSecret(): string {
    const primary = String(
      this.config.get('RETELL_WEBHOOK_SECRET') ?? '',
    ).trim();
    if (primary) return primary;
    return String(this.config.get('RETELL_TOOL_SECRET') ?? '').trim();
  }

  private extractProvidedSecret(request: Request): string | undefined {
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
