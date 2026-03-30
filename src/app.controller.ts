import { Controller, Get, Logger } from '@nestjs/common';
import { AppService } from './app.service';
import { WordpressService } from './wordpress/wordpress.service';
import { GoogleDriveService } from './google/google-drive.service';
import { ConfigService } from '@nestjs/config';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly appService: AppService,
    private readonly wordpressService: WordpressService,
    private readonly googleDriveService: GoogleDriveService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('test-wp')
  async testWordpress() {
    const fakeRetellData = {
      call_id: 'test_call_full_flow_123',
      call_analysis: {
        call_summary: 'TEST FINAL FASE 1: Local premium en el centro con escaparate de 5 metros.',
        custom_analysis_data: {
          tipo_inmueble: 'Local Premium',
          pueblo: 'Valencia Centro',
          nombre_via: 'Calle de Colón',
          altura: '10',
          precio_alquiler: '3000€',
          superficie_total: '150m2',
          estado_local: 'Excelente',
        },
      },
    };

    try {
      this.logger.log('Iniciando TEST FINAL FASE 1...');

      let featuredMediaId: number | undefined;
      const rootFolderId = this.configService.get<string>('DRIVE_ROOT_FOLDER_ID');

      if (rootFolderId) {
        this.logger.log(`Buscando imágenes en Drive (Folder ID: ${rootFolderId})...`);
        const images = await this.googleDriveService.getImagesFromFolder(rootFolderId);
        
        console.log(`[TEST-WP] Archivos encontrados en la carpeta: ${images.length}`);

        if (images.length > 0) {
          const chosenImage = images[0];
          console.log(`[TEST-WP] Imagen elegida para subir: ${chosenImage.name} (ID: ${chosenImage.id})`);
          
          this.logger.log(`Descargando buffer de: ${chosenImage.name}...`);
          const buffer = await this.googleDriveService.downloadImageBuffer(chosenImage.id!);
          
          this.logger.log('Subiendo a WordPress...');
          featuredMediaId = await this.wordpressService.uploadMedia(
            buffer, 
            chosenImage.name || `test_full_flow.jpg`
          );
        } else {
          console.warn('[TEST-WP] No se encontraron imágenes en la carpeta de Drive.');
        }
      }

      this.logger.log('Creando post en WordPress con los datos finales...');
      const result = await this.wordpressService.createPropertyPost(
        fakeRetellData,
        featuredMediaId,
      );

      return {
        success: true,
        message: 'TEST FINAL COMPLETADO: Post creado con imagen destacada',
        wp_id: result.id,
        featured_media_id: featuredMediaId,
        link: result.link,
      };
    } catch (error) {
      this.logger.error(`Error en el test final: ${error.message}`);
      return {
        success: false,
        message: 'Error en el Test Final de la Fase 1',
        error: error.response?.data || error.message,
      };
    }
  }
}
