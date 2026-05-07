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

  // Funciones de utilidad compartidas
  private sanitize(v: any, cleanSymbols: boolean = false): string {
    if (v === undefined || v === null) return '';
    let s = String(v).trim();
    const lowerS = s.toLowerCase();
    if (lowerS === 'no especificado' || lowerS === 'unknown' || lowerS === 'undefined' || lowerS === 'null') {
      return '';
    }
    if (cleanSymbols) {
      // 1. Eliminar símbolos de moneda, unidades y espacios
      s = s.replace(/[€$m²\s]/g, '');
      // 2. Si hay puntos y comas (ej: 1.200,50), eliminamos los puntos y cambiamos la coma por punto
      if (s.includes('.') && s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else if (s.includes(',')) {
        // Si solo hay coma (ej: 1200,50), la cambiamos por punto
        s = s.replace(',', '.');
      } else if (s.includes('.') && s.length > 3 && s.indexOf('.') === s.lastIndexOf('.')) {
        // Caso ambiguo: 1.200 (¿mil doscientos o uno con dos?). 
        // En inmuebles, suele ser mil doscientos. Si el punto está en posición de miles, lo quitamos.
        const parts = s.split('.');
        if (parts[1].length === 3) {
          s = s.replace('.', '');
        }
      }
    }
    return s;
  }

  private val(v: any, fallback: string = 'No especificado', cleanSymbols: boolean = false): string {
    const s = this.sanitize(v, cleanSymbols);
    return s !== '' ? s : fallback;
  }

  private formatCurrency(v: any): string {
    // Si v es un array (común en post_meta de WP), tomamos el primer elemento
    const valToSanitize = Array.isArray(v) ? v[0] : v;
    const s = this.sanitize(valToSanitize, true);
    if (!s) return 'A consultar';
    const num = parseFloat(s);
    if (isNaN(num)) return s;
    return new Intl.NumberFormat('es-ES').format(num) + ' €';
  }

  private formatSurface(v: any): string {
    const s = this.sanitize(v, true);
    if (!s) return 'No especificada';
    return s + ' m²';
  }

  async createPropertyPost(data: any, featuredMediaId?: number): Promise<any> {
    const cad = data.call_analysis?.custom_analysis_data;
    
    // Lógica de Título para WordPress: [Tipo de inmueble] en [Nombre via], [Pueblo/Barrio]
    const getWpTitle = () => {
      const tipo = this.val(cad?.tipo_inmueble, 'Local');
      const via = this.sanitize(cad?.nombre_via);
      const pueblo = this.sanitize(cad?.pueblo_barrio || cad?.pueblo);
      const municipio = this.sanitize(cad?.municipio);
      
      const ubicacionDetalle = [via, pueblo || municipio].filter(Boolean).join(', ');
      
      if (!ubicacionDetalle && tipo === 'Local') {
        return 'Inmueble Comercial en Localicer.com';
      }

      return `${tipo}${ubicacionDetalle ? ' en ' + ubicacionDetalle : ''}`;
    };

    const title = getWpTitle();

    // Contenido del post en HTML con los nuevos campos formateados
    const content = `
      <h3>Detalles del Inmueble</h3>
      <ul>
        <li><strong>Tipo de inmueble:</strong> ${this.val(cad?.tipo_inmueble)}</li>
        <li><strong>Estado:</strong> ${this.val(cad?.estado)}</li>
        <li><strong>Superficie Total:</strong> ${this.formatSurface(cad?.superficie_total)}</li>
        <li><strong>Superficie Útil:</strong> ${this.formatSurface(cad?.superficie_util)}</li>
        <li><strong>Precio Alquiler:</strong> ${this.formatCurrency(cad?.precio_alquiler)}</li>
        <li><strong>Precio Venta:</strong> ${this.formatCurrency(cad?.precio_venta)}</li>
        <li><strong>Precio Traspaso:</strong> ${this.formatCurrency(cad?.precio_traspaso)}</li>
        <li><strong>¿Fianza?:</strong> ${this.val(cad?.fianza_meses || cad?.fianza, 'A consultar')}</li>
        <li><strong>¿Gastos de comunidad?:</strong> ${this.formatCurrency(cad?.gastos_comunidad)}</li>
        <li><strong>Disponibilidad:</strong> ${this.val(cad?.disponibilidad)}</li>
      </ul>

      <h3>Características Técnicas</h3>
      <ul>
        <li><strong>Año de construcción:</strong> ${this.val(cad?.anio_construccion)}</li>
        <li><strong>Año de reforma:</strong> ${this.val(cad?.anio_reforma)}</li>
        <li><strong>Número de plantas:</strong> ${this.val(cad?.num_plantas)}</li>
        <li><strong>Número de aseos/baños:</strong> ${this.val(cad?.numero_aseos || cad?.aseos || cad?.numero_banios)}</li>
        <li><strong>Aforo máximo:</strong> ${this.val(cad?.aforo_maximo)}</li>
        <li><strong>Vado:</strong> ${this.val(cad?.vado)}</li>
        <li><strong>Altura techos:</strong> ${this.val(cad?.altura_techos, 'No especificada')}</li>
        <li><strong>Iluminación:</strong> ${this.val(cad?.iluminacion, 'No especificada')}</li>
        <li><strong>Suelos:</strong> ${this.val(cad?.suelos)}</li>
        <li><strong>Certificación energética:</strong> ${this.val(cad?.certificado_energetico || cad?.certificacion, 'No especificada')}</li>
      </ul>

      <h3>Distribución y Equipamiento</h3>
      <ul>
        <li><strong>Posición exacta:</strong> ${this.val(cad?.posicion_exacta)}</li>
        <li><strong>Escaparates/Ventanales:</strong> ${this.val(cad?.escaparates)}</li>
        <li><strong>Disposición (Diafano?):</strong> ${this.val(cad?.disposicion_diafano)}</li>
        <li><strong>Almacen/trastienda:</strong> ${this.formatSurface(cad?.almacen_trastienda)}</li>
        <li><strong>Terraza propia:</strong> ${this.formatSurface(cad?.terraza_patio)}</li>
        <li><strong>Equipamiento:</strong> ${this.val(cad?.equipamiento)}</li>
        <li><strong>Eventos permitidos:</strong> ${this.val(cad?.eventos)}</li>
        <li><strong>Limpieza:</strong> ${this.val(cad?.limpieza)}</li>
      </ul>

      <h3>Ubicación</h3>
      <ul>
        <li><strong>Dirección:</strong> ${this.val(cad?.tipo_via, '')} ${this.val(cad?.nombre_via, '')} ${this.val(cad?.numero_via || cad?.altura, '')}</li>
        <li><strong>Pueblo/Barrio:</strong> ${this.val(cad?.pueblo_barrio || cad?.pueblo, '')}</li>
        <li><strong>Municipio:</strong> ${this.val(cad?.municipio, '')}</li>
        <li><strong>Provincia:</strong> ${this.val(cad?.provincia, '')}</li>
      </ul>

      <h3>Información Adicional</h3>
      <p><strong>Negocio anterior:</strong> ${this.val(cad?.negocio_anterior)}</p>
      <p><strong>¿Negociable?:</strong> ${this.val(cad?.es_negociable)}</p>
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

  async searchProperties(filters: { type?: string; zone?: string; city?: string; budget?: number }): Promise<any[]> {
    const auth = Buffer.from(`${this.wpUser}:${this.wpPass}`).toString('base64');
    
    try {
      // Mapeo de categorías a slugs de WPResidence
      const categoryMapping: Record<string, string> = {
        'local': 'locales',
        'comercial': 'locales',
        'oficina': 'oficinas',
        'nave': 'naves-industriales',
        'industrial': 'naves-industriales',
        'almacen': 'naves-industriales'
      };

      const categorySlug = filters.type ? categoryMapping[filters.type.toLowerCase()] : undefined;
      const location = filters.city || filters.zone || '';
      
      const params: any = {
        per_page: 5,
        search: location,
      };

      // Si detectamos una categoría clara, usamos el filtro de taxonomía de WPResidence
      if (categorySlug) {
        params['property_category'] = categorySlug;
      } else if (filters.type) {
        params.search = `${filters.type} ${location}`.trim();
      }

      this.logger.log(`Buscando propiedades en WP con filtros: ${JSON.stringify(params)}`);

      const response = await lastValueFrom(
        this.httpService.get(`${this.wpUrl}/wp-json/wp/v2/estate_property`, {
          params: { ...params, _embed: 1 },
          headers: { Authorization: `Basic ${auth}` },
        })
      );

      return response.data.map((p: any) => {
        // Log para ver la estructura completa en la terminal
        // console.log('Estructura de la propiedad recibida de WP:', JSON.stringify(p, null, 2));

        // 1. Limpiar el título (HTML entities)
        let title = (p.title.rendered || '').replace(/&#8211;/g, '-');

        // 2. Extraer la operación desde los corchetes del título [ALQUILER], [VENTA], [TRASPASO]
        let operation: string = 'Venta'; // Default
        const opMatch = title.match(/\[(ALQUILER|VENTA|TRASPASO)\]/i);
        if (opMatch) {
          const op = opMatch[1].toUpperCase();
          if (op === 'ALQUILER') operation = 'Alquiler';
          if (op === 'VENTA') operation = 'Venta';
          if (op === 'TRASPASO') operation = 'Traspaso';
        }

        // 3. Extraer el precio
        let rawPrice = p.property_price || 
                         p.metadata?.property_price?.[0] || 
                         p.meta?.property_price || 
                         p.property_price_raw;

        if (!rawPrice && p.excerpt?.rendered) {
          rawPrice = p.excerpt.rendered.replace(/<[^>]*>/g, '').trim();
        }

        let formattedPrice = this.formatCurrency(rawPrice);
        
        // Si el precio es una descripción muy larga (>30 chars), lo marcamos como Consultar
        if (formattedPrice.length > 30) {
          formattedPrice = 'Consultar';
        }

        // 4. Extraer solo números para comparaciones matemáticas
        const priceNumber = parseInt(String(rawPrice || '').replace(/\D/g, ''), 10) || 0;

        return { 
          id: p.id,
          title: title,
          operation: operation,
          price: formattedPrice,
          priceNumber: priceNumber,
          link: p.link,
          address: p.property_address || '',
          city: p.property_city || '',
          area: p.property_area || '',
        };
      });
    } catch (error) {
      this.logger.error(`Error en searchProperties: ${error.response?.data?.message || error.message}`);
      throw new Error('API_FAILURE');
    }
  }
}
