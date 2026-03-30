import { Body, Controller, Logger, Post } from '@nestjs/common';
import { SheetsService } from './sheets.service';
import { WordpressService } from '../wordpress/wordpress.service';
import { GoogleDriveService } from '../google/google-drive.service';
import { ConfigService } from '@nestjs/config';

@Controller('webhooks')
export class SheetsController {
  private readonly logger = new Logger(SheetsController.name);

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly wordpressService: WordpressService,
    private readonly googleDriveService: GoogleDriveService,
    private readonly configService: ConfigService,
  ) {
    this.verifyDocAccess();
  }

  private verifyDocAccess(): void {
    const doc = this.sheetsService.getDoc();
    this.logger.log(
      `[verifyDocAccess] Documento accesible desde el controlador: ${doc?.title ?? 'aún no cargado'}`,
    );
  }

  @Post('retell')
  async handleRetellWebhook(@Body() body: Record<string, unknown>): Promise<void> {
    this.logger.log('[Retell Webhook] Body recibido:', body);

    try {
      // 1. Guardar en Google Sheets
      this.logger.log('Guardando datos en Google Sheets...');
      await this.sheetsService.addRow(body as any);

      // 2. Gestionar imágenes desde Google Drive
      let featuredMediaId: number | undefined;
      const rootFolderId = this.configService.get<string>('DRIVE_ROOT_FOLDER_ID');
      
      if (rootFolderId && body.call_id) {
        try {
          this.logger.log(`Buscando imágenes en Drive para call_id: ${body.call_id}`);
          const images = await this.googleDriveService.getImagesFromFolder(rootFolderId);
          
          if (images.length > 0) {
            this.logger.log(`Imagen encontrada: ${images[0].name}. Descargando...`);
            const buffer = await this.googleDriveService.downloadImageBuffer(images[0].id!);
            
            this.logger.log('Subiendo imagen a WordPress...');
            featuredMediaId = await this.wordpressService.uploadMedia(buffer, images[0].name || `call_${body.call_id}.jpg`);
          }
        } catch (driveError) {
          this.logger.error(`Error procesando imágenes de Drive: ${driveError.message}`);
        }
      }

      // 3. Crear Post en WordPress
      this.logger.log('Creando post en WordPress...');
      await this.wordpressService.createPropertyPost(body, featuredMediaId);

    } catch (error) {
      this.logger.error(`Error procesando el webhook: ${error.message}`, error.stack);
    }
  }
}
