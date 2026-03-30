import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class WordpressService {
  private readonly logger = new Logger(WordpressService.name);
  private readonly wpUrl: string;
  private readonly wpUser: string;
  private readonly wpPass: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.wpUrl = this.configService.getOrThrow<string>('WP_URL').replace(/\/$/, '');
    this.wpUser = this.configService.getOrThrow<string>('WP_USERNAME');
    this.wpPass = this.configService.getOrThrow<string>('WP_APP_PASSWORD');
  }

  async createPropertyPost(data: any, featuredMediaId?: number): Promise<any> {
    const cad = data.call_analysis?.custom_analysis_data;
    
    // Título descriptivo
    const title = `${cad?.tipo_inmueble || 'Inmueble'} en ${cad?.pueblo || 'ubicación desconocida'} - ${cad?.nombre_via || ''}`;

    // Contenido del post en HTML
    const content = `
      <ul>
        <li><strong>Tipo:</strong> ${cad?.tipo_inmueble || 'No especificado'}</li>
        <li><strong>Precio Alquiler:</strong> ${cad?.precio_alquiler || 'A consultar'}</li>
        <li><strong>Superficie Total:</strong> ${cad?.superficie_total || 'No especificada'}</li>
        <li><strong>Estado:</strong> ${cad?.estado_local || 'No especificado'}</li>
        <li><strong>Dirección:</strong> ${cad?.nombre_via || ''} ${cad?.altura || ''}, ${cad?.pueblo || ''}</li>
        <li><strong>Descripción:</strong> ${data.call_analysis?.call_summary || 'Sin descripción adicional.'}</li>
      </ul>
      <p><em>Publicado automáticamente desde Retell AI. Referencia: ${data.call_id}</em></p>
    `;

    const auth = Buffer.from(`${this.wpUser}:${this.wpPass}`).toString('base64');

    try {
      this.logger.log(`Intentando crear post en WordPress para: ${title}`);
      
      const response = await lastValueFrom(
        this.httpService.post(
          `${this.wpUrl}/wp-json/wp/v2/posts`,
          {
            title: title,
            content: content,
            status: 'draft', // Lo creamos como borrador por seguridad
            featured_media: featuredMediaId || undefined,
          },
          {
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'application/json',
            },
          }
        )
      );

      this.logger.log(`Post creado exitosamente en WP. ID: ${response.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error(
        `Error al crear post en WordPress: ${error.response?.data?.message || error.message}`,
        error.stack
      );
      throw error;
    }
  }

  async uploadMedia(buffer: Buffer, fileName: string): Promise<number> {
    const auth = Buffer.from(`${this.wpUser}:${this.wpPass}`).toString('base64');

    try {
      this.logger.log(`Subiendo imagen a WordPress: ${fileName}`);
      
      const response = await lastValueFrom(
        this.httpService.post(
          `${this.wpUrl}/wp-json/wp/v2/media`,
          buffer,
          {
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'image/jpeg', // O detectar por extensión si es necesario
              'Content-Disposition': `attachment; filename="${fileName}"`,
            },
          }
        )
      );

      this.logger.log(`Imagen subida exitosamente a WP. ID: ${response.data.id}`);
      return response.data.id;
    } catch (error) {
      this.logger.error(
        `Error al subir imagen a WordPress: ${error.response?.data?.message || error.message}`,
        error.stack
      );
      throw error;
    }
  }
}
