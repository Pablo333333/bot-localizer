import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { drive, drive_v3 } from '@googleapis/drive';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class GoogleDriveService implements OnModuleInit {
  private readonly logger = new Logger(GoogleDriveService.name);
  private driveClient: drive_v3.Drive;

  async onModuleInit(): Promise<void> {
    let credentials: any;

    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      try {
        credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        this.logger.log(
          'Google Drive: Usando credenciales desde variable de entorno',
        );
      } catch (err) {
        this.logger.error(
          'Error al parsear GOOGLE_CREDENTIALS_JSON, usando fallback de archivo',
        );
      }
    }

    if (!credentials) {
      const credentialsPath = path.join(
        process.cwd(),
        'google-credentials.json',
      );
      credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      this.logger.log('Google Drive: Usando credenciales desde archivo físico');
    }

    const auth = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    this.driveClient = drive({ version: 'v3', auth });
    this.logger.log('Google Drive Service inicializado correctamente');
  }

  async getImagesFromFolder(
    folderId: string,
    searchTerm?: string,
  ): Promise<drive_v3.Schema$File[]> {
    try {
      const safeTerm = searchTerm
        ? String(searchTerm).replace(/'/g, "\\'")
        : undefined;
      let query = `'${folderId}' in parents and (mimeType contains 'image/') and trashed = false`;
      if (safeTerm) {
        query += ` and name contains '${safeTerm}'`;
      }

      const response = await this.driveClient.files.list({
        q: query,
        fields: 'files(id, name, mimeType)',
        orderBy: 'name',
        pageSize: 100,
      });

      const files = response.data.files || [];
      return files.sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), 'es', {
          numeric: true,
          sensitivity: 'base',
        }),
      );
    } catch (error) {
      this.logger.error(
        `Error al listar archivos de la carpeta ${folderId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Busca una subcarpeta cuyo nombre contenga el término (p.ej. Call ID).
   */
  async findSubfolderByName(
    parentFolderId: string,
    nameContains: string,
  ): Promise<string | null> {
    const safeTerm = String(nameContains || '')
      .trim()
      .replace(/'/g, "\\'");
    if (!safeTerm) return null;

    try {
      const response = await this.driveClient.files.list({
        q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name contains '${safeTerm}' and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 10,
      });
      const folder = response.data.files?.[0];
      return folder?.id || null;
    } catch (error: any) {
      this.logger.warn(
        `No se pudo buscar subcarpeta "${safeTerm}" en ${parentFolderId}: ${error.message}`,
      );
      return null;
    }
  }

  async getFileMetadata(
    fileId: string,
  ): Promise<{ id: string; name?: string | null; mimeType?: string | null }> {
    const meta = await this.driveClient.files.get({
      fileId,
      fields: 'id, name, mimeType',
    });
    return {
      id: meta.data.id || fileId,
      name: meta.data.name,
      mimeType: meta.data.mimeType,
    };
  }

  async downloadImageBuffer(fileId: string): Promise<Buffer> {
    try {
      const response = await this.driveClient.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );

      return Buffer.from(response.data as ArrayBuffer);
    } catch (error) {
      this.logger.error(
        `Error al descargar el buffer de la imagen ${fileId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Extrae el fileId de URLs típicas de Google Drive (archivo, no carpeta).
   * Soporta: /file/d/ID/, open?id=, uc?id=, drive.google.com/uc?export=download&id=
   */
  extractFileIdFromUrl(url: string): string | null {
    if (!url) return null;
    const trimmed = url.trim();
    if (/\/(?:drive\/)?folders\//i.test(trimmed)) {
      return null;
    }

    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]+)/,
      /[?&]id=([a-zA-Z0-9_-]+)/,
      /\/d\/([a-zA-Z0-9_-]+)/,
    ];

    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m?.[1]) return m[1];
    }

    // Si ya parece un ID crudo
    if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
      return trimmed;
    }

    return null;
  }

  /** Extrae folderId de URLs /drive/folders/ID o ID crudo. */
  extractFolderIdFromUrl(url: string): string | null {
    if (!url) return null;
    const trimmed = url.trim();
    const folderMatch = trimmed.match(
      /\/(?:drive\/)?folders\/([a-zA-Z0-9_-]+)/i,
    );
    if (folderMatch?.[1]) return folderMatch[1];
    if (
      /^[a-zA-Z0-9_-]{20,}$/.test(trimmed) &&
      !/\/file\/d\//i.test(trimmed)
    ) {
      return trimmed;
    }
    return null;
  }

  /** Convierte un link de Drive a URL de descarga directa (útil para logs / fallback HTTP). */
  toDirectDownloadUrl(fileIdOrUrl: string): string {
    const fileId =
      this.extractFileIdFromUrl(fileIdOrUrl) || fileIdOrUrl.trim();
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  /**
   * Descarga una imagen desde una URL de Google Drive (o ID) usando la API de Drive.
   */
  async downloadImageFromUrl(
    driveUrl: string,
  ): Promise<{ buffer: Buffer; fileId: string; fileName: string; mimeType: string }> {
    const fileId = this.extractFileIdFromUrl(driveUrl);
    if (!fileId) {
      throw new Error(`No se pudo extraer fileId de la URL de Drive: ${driveUrl}`);
    }

    this.logger.log(`Descargando imagen de Drive por URL. fileId=${fileId}`);

    let fileName = `drive_${fileId}.jpg`;
    let mimeType = 'image/jpeg';

    try {
      const meta = await this.driveClient.files.get({
        fileId,
        fields: 'id, name, mimeType',
      });
      if (meta.data.name) fileName = meta.data.name;
      if (meta.data.mimeType) mimeType = meta.data.mimeType;
    } catch (metaErr: any) {
      this.logger.warn(
        `No se pudo leer metadata de Drive (${fileId}): ${metaErr.message}. Se usará nombre por defecto.`,
      );
    }

    const buffer = await this.downloadImageBuffer(fileId);
    return { buffer, fileId, fileName, mimeType };
  }
}
