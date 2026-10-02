import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import {
  PlanStatus,
  SyncUserPlanPayload,
} from './dto/sync-user-plan.dto';
import {
  buildEstatePropertyPayload,
  formatCurrencyDisplay,
  sanitizeValue,
  toWordpressRequestBody,
} from './property-mapper';
import { normalizeImageMimeType } from '../google/drive-file.util';
import {
  candidateFileName,
  MAX_MEDIA_HASH_LOOKUPS,
  mediaNameKey,
  pickReusableMediaId,
  sanitizeWpMediaFileName,
  sha256Buffer,
  type WpMediaCandidate,
} from './property-media-dedup';

@Injectable()
export class WordpressService {
  private readonly logger = new Logger(WordpressService.name);
  private readonly wpUrl: string;
  /** Base de la REST API, p.ej. https://www.localicer.com/wp-json */
  private readonly apiUrl: string;
  private readonly wpUser: string;
  private readonly wpPass: string;
  private readonly apiToken?: string;
  private readonly stripeSyncPath: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.wpUrl = this.configService.getOrThrow<string>('WP_URL').replace(/\/$/, '');
    this.apiUrl = (
      this.configService.get<string>('WORDPRESS_API_URL') ||
      `${this.wpUrl}/wp-json`
    ).replace(/\/$/, '');
    this.wpUser =
      this.configService.get<string>('WORDPRESS_API_USER') ||
      this.configService.getOrThrow<string>('WP_USERNAME');
    this.wpPass =
      this.configService.get<string>('WORDPRESS_API_PASSWORD') ||
      this.configService.getOrThrow<string>('WP_APP_PASSWORD');
    this.apiToken =
      this.configService.get<string>('WORDPRESS_API_TOKEN') || undefined;
    this.stripeSyncPath =
      this.configService.get<string>('WORDPRESS_STRIPE_SYNC_PATH') ||
      '/localicer/v1/stripe/sync-plan';
  }

  private getAuthHeaders(
    extra: Record<string, string> = {},
  ): Record<string, string> {
    if (this.apiToken) {
      return {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...extra,
      };
    }

    const auth = Buffer.from(`${this.wpUser}:${this.wpPass}`).toString('base64');
    return {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  private formatCurrency(v: any): string {
    return formatCurrencyDisplay(v);
  }

  /**
   * Crea o actualiza un estate_property desde datos de llamada/CAD (Retell o Sheet).
   */
  async upsertPropertyFromCallData(
    callData: Parameters<typeof buildEstatePropertyPayload>[0],
    options: {
      postId?: number;
      featuredMediaId?: number;
      galleryMediaIds?: number[];
      status?: string;
      /** Si true, no envía `status` en update (protege publish frente a pending). */
      preserveStatus?: boolean;
      commercialContent?: string;
    } = {},
  ): Promise<{ id: number; created: boolean } | null> {
    const status =
      options.status ||
      this.configService.get<string>('WP_POST_STATUS') ||
      'draft';

    const payload = buildEstatePropertyPayload(callData, {
      status,
      featuredMediaId: options.featuredMediaId,
      galleryMediaIds: options.galleryMediaIds,
      commercialContent: options.commercialContent,
    });
    const body = toWordpressRequestBody(payload);

    if (options.postId) {
      if (options.preserveStatus) {
        delete body.status;
      }
      try {
        this.logger.log(
          `Actualizando estate_property ${options.postId}: "${payload.title}" (agent=${payload.meta.property_agent} author=${payload.author} featured=${options.featuredMediaId || '-'} gallery=${options.galleryMediaIds?.length || 0} preserveStatus=${!!options.preserveStatus})`,
        );
        const response = await lastValueFrom(
          this.httpService.post(
            `${this.apiUrl}/wp/v2/estate_property/${options.postId}`,
            body,
            { headers: this.getAuthHeaders() },
          ),
        );
        return { id: response.data.id ?? options.postId, created: false };
      } catch (error: unknown) {
        this.warnWpApiFailure(
          `actualizar estate_property ${options.postId}`,
          error,
        );
        return null;
      }
    }

    try {
      const created = await this.createPropertyPost(
        callData,
        options.featuredMediaId,
        status,
        options.commercialContent,
        options.galleryMediaIds,
      );
      if (!created?.id) return null;
      return { id: created.id, created: true };
    } catch (error: unknown) {
      this.warnWpApiFailure('crear estate_property', error);
      return null;
    }
  }

  /** Lectura ligera de estado WP (para protección de publicados). */
  async getEstatePropertyBrief(
    postId: number,
  ): Promise<{ id: number; status: string; modified?: string } | null> {
    try {
      const response = await lastValueFrom(
        this.httpService.get(
          `${this.apiUrl}/wp/v2/estate_property/${postId}?_fields=id,status,modified`,
          { headers: this.getAuthHeaders() },
        ),
      );
      return {
        id: response.data.id,
        status: String(response.data.status || ''),
        modified: response.data.modified,
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.logger.warn(
        `No se pudo leer estate_property ${postId}: ${
          error.response?.data?.message || error.message
        }`,
      );
      return null;
    }
  }

  /**
   * Crea un inmueble como CPT `estate_property` (WP Residence)
   * vía POST /wp/v2/estate_property con meta nativa.
   */
  async createPropertyPost(
    data: any,
    featuredMediaId?: number,
    statusOverride?: string,
    commercialContent?: string,
    galleryMediaIds?: number[],
  ): Promise<any> {
    const status =
      statusOverride ||
      this.configService.get<string>('WP_POST_STATUS') ||
      'draft';

    const payload = buildEstatePropertyPayload(data, {
      status,
      featuredMediaId,
      galleryMediaIds,
      commercialContent,
    });
    const body = toWordpressRequestBody(payload);

    try {
      this.logger.log(
        `Creando estate_property en WP: "${payload.title}" (status=${status} agent=${payload.meta.property_agent} author=${payload.author})`,
      );
      this.logger.debug(`Meta WP Residence: ${JSON.stringify(payload.meta)}`);

      const response = await lastValueFrom(
        this.httpService.post(`${this.apiUrl}/wp/v2/estate_property`, body, {
          headers: this.getAuthHeaders(),
        }),
      );

      this.logger.log(
        `Inmueble estate_property creado. ID: ${response.data.id}`,
      );
      return response.data;
    } catch (error: unknown) {
      this.warnWpApiFailure('crear estate_property', error);
      return null;
    }
  }

  /**
   * Expone el payload que se enviaría a WP (útil para tests/mocks).
   */
  buildPropertyRequestPreview(
    data: any,
    featuredMediaId?: number,
  ): Record<string, unknown> {
    const status =
      this.configService.get<string>('WP_POST_STATUS') || 'draft';
    const payload = buildEstatePropertyPayload(data, {
      status,
      featuredMediaId,
    });
    return {
      endpoint: `${this.apiUrl}/wp/v2/estate_property`,
      body: toWordpressRequestBody(payload),
      mapping: payload._mapping,
    };
  }

  /**
   * Actualiza un estate_property existente (sync desde Google Sheets).
   */
  async updatePropertyPost(
    postId: number,
    fields: {
      tipo_inmueble?: string;
      municipio?: string;
      precio_alquiler?: string;
      precio_venta?: string;
      disponibilidad?: string;
      estado?: string;
      title?: string;
    },
  ): Promise<any> {
    const title =
      fields.title ||
      (fields.tipo_inmueble && fields.municipio
        ? `${fields.tipo_inmueble} en ${fields.municipio}`
        : undefined);

    const meta: Record<string, string> = {};
    const alquiler = sanitizeValue(fields.precio_alquiler, true);
    const venta = sanitizeValue(fields.precio_venta, true);
    if (alquiler) {
      meta.property_price = alquiler;
      meta.property_label = '/mes';
    } else if (venta) {
      meta.property_price = venta;
    }
    const estado = sanitizeValue(fields.estado);
    if (estado) meta.property_status = estado;
    const municipio = sanitizeValue(fields.municipio);
    if (municipio) meta.property_address = municipio;

    const payload: Record<string, unknown> = {};
    if (title) payload.title = title;
    if (Object.keys(meta).length) payload.meta = meta;

    if (Object.keys(payload).length === 0) {
      this.logger.warn(`updatePropertyPost ${postId}: nothing to update`);
      return null;
    }

    try {
      const response = await lastValueFrom(
        this.httpService.post(
          `${this.apiUrl}/wp/v2/estate_property/${postId}`,
          payload,
          { headers: this.getAuthHeaders() },
        ),
      );
      this.logger.log(
        `estate_property ${postId} actualizado desde Sheets sync`,
      );
      return response.data;
    } catch (error: unknown) {
      this.warnWpApiFailure(`actualizar estate_property ${postId}`, error);
      return null;
    }
  }

  async uploadMedia(
    buffer: Buffer,
    fileName: string,
    mimeType = 'image/jpeg',
    options: { postId?: number } = {},
  ): Promise<number | null> {
    try {
      const contentType = normalizeImageMimeType(mimeType);
      const safeName = this.sanitizeMediaFileName(fileName, contentType);
      const existingId = await this.findReusableMediaId(
        buffer,
        safeName,
        options.postId,
      );
      if (existingId != null) {
        this.logger.log(
          `Imagen ya en la biblioteca WP. Se reutiliza media_id=${existingId} (${safeName})`,
        );
        return existingId;
      }

      this.logger.log(
        `Subiendo imagen a WordPress: ${safeName}${options.postId ? ` (post=${options.postId})` : ''} bytes=${buffer.length} mime=${contentType}`,
      );

      const url = options.postId
        ? `${this.apiUrl}/wp/v2/media?post=${options.postId}`
        : `${this.apiUrl}/wp/v2/media`;

      const response = await lastValueFrom(
        this.httpService.post(url, buffer, {
          headers: this.getAuthHeaders({
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${safeName}"`,
          }),
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      );

      this.logger.log(
        `Imagen subida exitosamente a WP. ID: ${response.data.id}`,
      );
      return response.data.id;
    } catch (error: unknown) {
      this.warnWpApiFailure(`subir imagen ${fileName}`, error);
      return null;
    }
  }

  /** WP rechaza Content-Disposition con acentos/espacios raros — ASCII seguro. */
  private sanitizeMediaFileName(fileName: string, mimeType: string): string {
    return sanitizeWpMediaFileName(fileName, mimeType);
  }

  /**
   * Busca en la biblioteca (y en los adjuntos del post) un archivo con el mismo
   * nombre o el mismo hash. Si existe, devuelve su id para no duplicar la subida.
   */
  async findReusableMediaId(
    buffer: Buffer,
    fileName: string,
    postId?: number,
  ): Promise<number | null> {
    const safeName = this.sanitizeMediaFileName(
      fileName,
      'image/jpeg',
    );
    const contentHash = sha256Buffer(buffer);
    let candidates: WpMediaCandidate[] = [];
    try {
      candidates = await this.collectMediaCandidates(safeName, postId);
    } catch (error: unknown) {
      this.warnWpApiFailure(`buscar imagen ${safeName}`, error);
      return null;
    }
    if (candidates.length === 0) return null;

    const hashes = new Map<number, string>();
    const wantName = mediaNameKey(safeName);
    let lookups = 0;
    for (const candidate of candidates) {
      if (lookups >= MAX_MEDIA_HASH_LOOKUPS) break;
      const sameName = mediaNameKey(candidateFileName(candidate)) === wantName;
      const sameSize =
        candidate.filesize != null && candidate.filesize === buffer.length;
      const attached = postId != null && candidate.parent === postId;
      if (!sameName && !sameSize && !attached) continue;
      if (!candidate.sourceUrl) continue;
      lookups += 1;
      const remoteHash = await this.hashRemoteMedia(candidate.sourceUrl);
      if (remoteHash) hashes.set(candidate.id, remoteHash);
    }

    return pickReusableMediaId(candidates, {
      fileName: safeName,
      byteLength: buffer.length,
      contentHash,
      hashes,
      postId,
    });
  }

  private async collectMediaCandidates(
    fileName: string,
    postId?: number,
  ): Promise<WpMediaCandidate[]> {
    const byId = new Map<number, WpMediaCandidate>();
    const remember = (items: unknown) => {
      if (!Array.isArray(items)) return;
      for (const raw of items) {
        const mapped = this.mapMediaCandidate(raw);
        if (mapped) byId.set(mapped.id, mapped);
      }
    };

    if (postId) {
      remember(await this.listMedia({ parent: postId, per_page: 100 }));
    }

    const stem = mediaNameKey(fileName).replace(/\.[a-z0-9]+$/i, '');
    if (stem) {
      remember(
        await this.listMedia({
          search: stem.slice(0, 40),
          media_type: 'image',
          per_page: 50,
        }),
      );
    }

    return [...byId.values()];
  }

  private async listMedia(
    params: Record<string, string | number>,
  ): Promise<unknown[]> {
    const response = await lastValueFrom(
      this.httpService.get(`${this.apiUrl}/wp/v2/media`, {
        params,
        headers: this.getAuthHeaders(),
      }),
    );
    return Array.isArray(response.data) ? response.data : [];
  }

  private mapMediaCandidate(raw: unknown): WpMediaCandidate | null {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as {
      id?: number;
      source_url?: string;
      post?: number;
      media_details?: { file?: string; filesize?: number };
    };
    const id = Number(item.id);
    if (!Number.isFinite(id)) return null;
    const filesize = Number(item.media_details?.filesize);
    return {
      id,
      sourceUrl: item.source_url ? String(item.source_url) : undefined,
      file: item.media_details?.file
        ? String(item.media_details.file)
        : undefined,
      filesize: Number.isFinite(filesize) ? filesize : undefined,
      parent: item.post != null ? Number(item.post) : undefined,
    };
  }

  private async hashRemoteMedia(sourceUrl: string): Promise<string | null> {
    try {
      const response = await lastValueFrom(
        this.httpService.get(sourceUrl, {
          responseType: 'arraybuffer',
          headers: this.getAuthHeaders(),
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 20000,
        }),
      );
      return sha256Buffer(Buffer.from(response.data));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[WordPress] No se pudo hashear ${sourceUrl}: ${message}`,
      );
      return null;
    }
  }

  /** Asocia un adjunto existente como hijo del estate_property (galería WPResidence). */
  async attachMediaToPost(mediaId: number, postId: number): Promise<void> {
    try {
      await lastValueFrom(
        this.httpService.post(
          `${this.apiUrl}/wp/v2/media/${mediaId}`,
          { post: postId },
          { headers: this.getAuthHeaders() },
        ),
      );
    } catch (error: unknown) {
      this.warnWpApiFailure(
        `asociar media ${mediaId} al post ${postId}`,
        error,
      );
    }
  }

  /**
   * Un 403 u otro fallo de la REST API no debe abortar llamadas ni seguimientos.
   */
  private warnWpApiFailure(action: string, error: unknown): void {
    const err = error as {
      message?: string;
      stack?: string;
      response?: { status?: number; data?: { message?: string } | string };
    };
    const status = err?.response?.status;
    const dataMessage =
      typeof err?.response?.data === 'string'
        ? err.response.data
        : err?.response?.data?.message;
    const message = dataMessage || err?.message || String(error);
    this.logger.warn(
      `[WordPress] ${action} omitido` +
        (status != null ? ` (HTTP ${status})` : '') +
        `: ${message}. Llamadas y seguimiento no se detienen.`,
    );
  }

  /**
   * Activa o renueva el plan del usuario tras un cobro exitoso en Stripe.
   * WordPress debe exponer el endpoint configurado en WORDPRESS_STRIPE_SYNC_PATH
   * y actualizar rol / meta (plan_status, anuncios_limite, price_id, etc.).
   */
  async activateUserPlan(
    payload: Omit<SyncUserPlanPayload, 'planStatus'> & {
      planStatus?: PlanStatus;
    },
  ): Promise<any> {
    return this.syncUserPlan({
      ...payload,
      planStatus: payload.planStatus ?? 'active',
    });
  }

  /**
   * Marca la suscripción como cancelada / plan gratuito en WordPress.
   */
  async cancelUserPlan(
    payload: Omit<SyncUserPlanPayload, 'planStatus' | 'event'> & {
      event?: SyncUserPlanPayload['event'];
    },
  ): Promise<any> {
    return this.syncUserPlan({
      ...payload,
      planStatus: 'cancelled',
      event: payload.event ?? 'customer.subscription.deleted',
      meta: {
        plan_status: 'cancelled',
        ...payload.meta,
      },
    });
  }

  /**
   * Envía el estado del plan a WordPress (endpoint Localicer).
   * Payload esperado por WP: userId/email, priceId, plan_status, meta...
   */
  async syncUserPlan(payload: SyncUserPlanPayload): Promise<any> {
    const path = this.stripeSyncPath.startsWith('/')
      ? this.stripeSyncPath
      : `/${this.stripeSyncPath}`;
    const url = `${this.apiUrl}${path}`;

    const body = {
      user_id: payload.userId,
      email: payload.email,
      price_id: payload.priceId,
      plan_status: payload.planStatus,
      mode: payload.mode,
      stripe_session_id: payload.stripeSessionId,
      stripe_subscription_id: payload.stripeSubscriptionId,
      stripe_customer_id: payload.stripeCustomerId,
      stripe_invoice_id: payload.stripeInvoiceId,
      event: payload.event,
      meta: {
        plan_status: payload.planStatus,
        price_id: payload.priceId,
        ...payload.meta,
      },
    };

    try {
      this.logger.log(
        `Sincronizando plan WP: userId=${payload.userId} | status=${payload.planStatus} | event=${payload.event}`,
      );

      const response = await lastValueFrom(
        this.httpService.post(url, body, {
          headers: this.getAuthHeaders(),
        }),
      );

      this.logger.log(
        `Plan sincronizado en WP para userId=${payload.userId}: ${JSON.stringify(response.data)}`,
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Error al sincronizar plan en WordPress: ${error.response?.data?.message || error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async searchProperties(filters: {
    type?: string;
    zone?: string;
    city?: string;
    budget?: number;
  }): Promise<any[]> {
    try {
      const categoryMapping: Record<string, string> = {
        local: 'local',
        comercial: 'local',
        oficina: 'oficina',
        nave: 'nave',
        industrial: 'nave',
        almacen: 'nave',
        almacén: 'nave',
      };

      const categorySlug = filters.type
        ? categoryMapping[filters.type.toLowerCase()]
        : undefined;
      const location = filters.city || filters.zone || '';

      const params: any = {
        per_page: 5,
        search: location,
      };

      if (categorySlug) {
        params['property_category'] = categorySlug;
      } else if (filters.type) {
        params.search = `${filters.type} ${location}`.trim();
      }

      this.logger.log(
        `Buscando propiedades en WP con filtros: ${JSON.stringify(params)}`,
      );

      const response = await lastValueFrom(
        this.httpService.get(`${this.apiUrl}/wp/v2/estate_property`, {
          params: { ...params, _embed: 1 },
          headers: this.getAuthHeaders(),
        }),
      );

      return response.data.map((p: any) => {
        let title = (p.title.rendered || '').replace(/&#8211;/g, '-');

        let operation: string = 'Venta';
        const opMatch = title.match(/\[(ALQUILER|VENTA|TRASPASO)\]/i);
        if (opMatch) {
          const op = opMatch[1].toUpperCase();
          if (op === 'ALQUILER') operation = 'Alquiler';
          if (op === 'VENTA') operation = 'Venta';
          if (op === 'TRASPASO') operation = 'Traspaso';
        }

        let rawPrice =
          p.property_price ||
          p.metadata?.property_price?.[0] ||
          p.meta?.property_price ||
          p.property_price_raw;

        if (!rawPrice && p.excerpt?.rendered) {
          rawPrice = p.excerpt.rendered.replace(/<[^>]*>/g, '').trim();
        }

        let formattedPrice = this.formatCurrency(rawPrice);

        if (formattedPrice.length > 30) {
          formattedPrice = 'Consultar';
        }

        const priceNumber =
          parseInt(String(rawPrice || '').replace(/\D/g, ''), 10) || 0;

        return {
          id: p.id,
          title: title,
          operation: operation,
          price: formattedPrice,
          priceNumber: priceNumber,
          link: p.link,
          address: p.property_address || p.meta?.property_address || '',
          city: p.property_city || '',
          area: p.property_area || '',
        };
      });
    } catch (error) {
      this.logger.error(
        `Error en searchProperties: ${error.response?.data?.message || error.message}`,
      );
      throw new Error('API_FAILURE');
    }
  }
}
