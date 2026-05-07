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
    // ... existing testWordpress code ...
  }

  @Get('test-search')
  async testSearch() {
    try {
      this.logger.log('Iniciando TEST de búsqueda de locales en Palma...');
      const results = await this.wordpressService.searchProperties({ city: 'Palma' });
      return {
        success: true,
        count: results.length,
        results,
      };
    } catch (error) {
      this.logger.error(`Error en el test de búsqueda: ${error.message}`);
      return {
        success: false,
        message: 'Error al conectar con WPResidence',
        error: error.message,
      };
    }
  }
}
