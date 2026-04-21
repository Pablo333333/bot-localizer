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
    
    // Función auxiliar para sanitizar valores
    const sanitize = (v: any, cleanSymbols: boolean = false) => {
      if (v === undefined || v === null) return '';
      let s = String(v).trim();
      const lowerS = s.toLowerCase();
      if (lowerS === 'no especificado' || lowerS === 'unknown' || lowerS === 'undefined' || lowerS === 'null') {
        return '';
      }
      if (cleanSymbols) {
        // Limpiar símbolos de moneda y unidades para campos numéricos
        s = s.replace(/[€$m²\s]/g, '').replace(',', '.');
      }
      return s;
    };

    const val = (v: any, fallback: string = 'No especificado', cleanSymbols: boolean = false) => {
      const s = sanitize(v, cleanSymbols);
      return s !== '' ? s : fallback;
    };

    // Lógica de Título para WordPress: [Tipo de inmueble] en [Nombre via], [Pueblo/Barrio]
    const getWpTitle = () => {
      const tipo = val(cad?.tipo_inmueble, 'Local');
      const via = sanitize(cad?.nombre_via);
      const pueblo = sanitize(cad?.pueblo_barrio || cad?.pueblo);
      const municipio = sanitize(cad?.municipio);
      
      const ubicacionDetalle = [via, pueblo || municipio].filter(Boolean).join(', ');
      
      if (!ubicacionDetalle && tipo === 'Local') {
        return 'Inmueble Comercial en Localicer.com';
      }

      return `${tipo}${ubicacionDetalle ? ' en ' + ubicacionDetalle : ''}`;
    };

    const title = getWpTitle();

    // Función auxiliar para formatear moneda
    const formatCurrency = (v: any) => {
      const s = sanitize(v, true); // Limpiamos símbolos previos
      if (!s) return 'A consultar';
      const num = parseFloat(s);
      if (isNaN(num)) return s;
      return new Intl.NumberFormat('es-ES').format(num) + ' €';
    };

    // Función auxiliar para formatear superficie
    const formatSurface = (v: any) => {
      const s = sanitize(v, true);
      if (!s) return 'No especificada';
      return s + ' m²';
    };

    // Contenido del post en HTML con los nuevos campos formateados
    const content = `
      <h3>Detalles del Inmueble</h3>
      <ul>
        <li><strong>Tipo de inmueble:</strong> ${val(cad?.tipo_inmueble)}</li>
        <li><strong>Estado:</strong> ${val(cad?.estado)}</li>
        <li><strong>Superficie Total:</strong> ${formatSurface(cad?.superficie_total)}</li>
        <li><strong>Superficie Útil:</strong> ${formatSurface(cad?.superficie_util)}</li>
        <li><strong>Precio Alquiler:</strong> ${formatCurrency(cad?.precio_alquiler)}</li>
        <li><strong>Precio Venta:</strong> ${formatCurrency(cad?.precio_venta)}</li>
        <li><strong>Precio Traspaso:</strong> ${formatCurrency(cad?.precio_traspaso)}</li>
        <li><strong>¿Fianza?:</strong> ${val(cad?.fianza_meses || cad?.fianza, 'A consultar')}</li>
        <li><strong>¿Gastos de comunidad?:</strong> ${formatCurrency(cad?.gastos_comunidad)}</li>
        <li><strong>Disponibilidad:</strong> ${val(cad?.disponibilidad)}</li>
      </ul>

      <h3>Características Técnicas</h3>
      <ul>
        <li><strong>Año de construcción:</strong> ${val(cad?.anio_construccion)}</li>
        <li><strong>Año de reforma:</strong> ${val(cad?.anio_reforma)}</li>
        <li><strong>Número de plantas:</strong> ${val(cad?.num_plantas)}</li>
        <li><strong>Número de aseos/baños:</strong> ${val(cad?.numero_aseos || cad?.aseos)}</li>
        <li><strong>Vado:</strong> ${val(cad?.vado)}</li>
        <li><strong>Altura techos:</strong> ${val(cad?.altura_techos, 'No especificada')}</li>
        <li><strong>Iluminación:</strong> ${val(cad?.iluminacion, 'No especificada')}</li>
        <li><strong>Suelos:</strong> ${val(cad?.suelos)}</li>
        <li><strong>Certificación energética:</strong> ${val(cad?.certificacion, 'No especificada')}</li>
      </ul>

      <h3>Ubicación</h3>
      <ul>
        <li><strong>Dirección:</strong> ${val(cad?.tipo_via, '')} ${val(cad?.nombre_via, '')} ${val(cad?.numero_via || cad?.altura, '')}</li>
        <li><strong>Pueblo/Barrio:</strong> ${val(cad?.pueblo_barrio || cad?.pueblo, '')}</li>
        <li><strong>Municipio:</strong> ${val(cad?.municipio, '')}</li>
        <li><strong>Provincia:</strong> ${val(cad?.provincia, '')}</li>
      </ul>

      <h3>Información Adicional</h3>
      <p><strong>Negocio anterior:</strong> ${val(cad?.negocio_anterior)}</p>
      <p><strong>¿Negociable?:</strong> ${val(cad?.es_negociable)}</p>
      <p><strong>Descripción:</strong> ${data.call_analysis?.call_summary || cad?.informacion_adicional || 'Sin descripción adicional.'}</p>
      
      <hr>
      <p><em>Publicado automáticamente por Localisto IA. Referencia de llamada: ${data.call_id}</em></p>
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
            status: this.configService.get<string>('WP_POST_STATUS') || 'draft',
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
