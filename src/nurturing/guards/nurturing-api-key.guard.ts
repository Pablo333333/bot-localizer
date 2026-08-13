import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Guard simple para rutas /nurturing/*.
 * Header: `x-api-key: <NURTURING_API_KEY>`
 */
@Injectable()
export class NurturingApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('NURTURING_API_KEY');
    if (!expected) {
      throw new UnauthorizedException('NURTURING_API_KEY is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided =
      (request.headers['x-api-key'] as string | undefined) ||
      this.bearerToken(request.headers.authorization);

    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }

  private bearerToken(authorization?: string): string | undefined {
    if (!authorization?.startsWith('Bearer ')) return undefined;
    return authorization.slice(7).trim();
  }
}
