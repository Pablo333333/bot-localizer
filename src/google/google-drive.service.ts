import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class GoogleDriveService implements OnModuleInit {
  private readonly logger = new Logger(GoogleDriveService.name);
  private drive: drive_v3.Drive;

  async onModuleInit(): Promise<void> {
    const credentials = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'google-credentials.json'),
        'utf8',
      ),
    );

    const auth = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    this.drive = google.drive({ version: 'v3', auth });
    this.logger.log('Google Drive Service inicializado correctamente');
  }

  async getImagesFromFolder(folderId: string): Promise<drive_v3.Schema$File[]> {
    try {
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and (mimeType contains 'image/') and trashed = false`,
        fields: 'files(id, name, mimeType)',
      });

      return response.data.files || [];
    } catch (error) {
      this.logger.error(`Error al listar archivos de la carpeta ${folderId}: ${error.message}`);
      throw error;
    }
  }

  async downloadImageBuffer(fileId: string): Promise<Buffer> {
    try {
      const response = await this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );

      return Buffer.from(response.data as ArrayBuffer);
    } catch (error) {
      this.logger.error(`Error al descargar el buffer de la imagen ${fileId}: ${error.message}`);
      throw error;
    }
  }
}
