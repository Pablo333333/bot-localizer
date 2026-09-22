import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { drive, drive_v3 } from '@googleapis/drive';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import {
  assertImageBuffer,
  downloadPublicDriveFile,
  extractDriveFileIdFromUrl,
  isLikelyHtmlBuffer,
} from './drive-file.util';

/** Flags necesarios para Shared Drives / unidades compartidas. */
const DRIVE_LIST_OPTS = {
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
  corpora: 'allDrives' as const,
};

const DRIVE_FILE_OPTS = {
  supportsAllDrives: true,
};

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
    this.logger.log(
      'Google Drive Service inicializado (supportsAllDrives=true)',
    );
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
        ...DRIVE_LIST_OPTS,
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
   * Busca una subcarpeta cuyo nombre contenga el término (p.ej. Call ID / ID_WP).
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
        ...DRIVE_LIST_OPTS,
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
  ): Promise<{
    id: string;
    name?: string | null;
    mimeType?: string | null;
    shortcutTargetId?: string | null;
  }> {
    const meta = await this.driveClient.files.get({
      fileId,
      fields: 'id, name, mimeType, shortcutDetails',
      ...DRIVE_FILE_OPTS,
    });
    return {
      id: meta.data.id || fileId,
      name: meta.data.name,
      mimeType: meta.data.mimeType,
      shortcutTargetId: meta.data.shortcutDetails?.targetId || null,
    };
  }

  /**
   * Resuelve shortcuts de Drive al archivo imagen real.
   */
  async resolveImageFileId(fileId: string): Promise<{
    id: string;
    name?: string | null;
    mimeType?: string | null;
  }> {
    const meta = await this.getFileMetadata(fileId);
    if (
      meta.mimeType === 'application/vnd.google-apps.shortcut' &&
      meta.shortcutTargetId
    ) {
      this.logger.log(
        `Drive shortcut ${fileId} → target ${meta.shortcutTargetId}`,
      );
      return this.getFileMetadata(meta.shortcutTargetId);
    }
    return meta;
  }

  async downloadImageBuffer(fileId: string): Promise<Buffer> {
    const { buffer } = await this.downloadImageFile(fileId);
    return buffer;
  }

  /**
   * Descarga un archivo imagen: API de Drive (cuenta de servicio) y, si falla
   * (403/404 / HTML de confirmación), URL pública uc?export=download.
   */
  async downloadImageFile(
    fileId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName?: string }> {
    let resolvedId = fileId;
    let fileName: string | undefined;
    try {
      const resolved = await this.resolveImageFileId(fileId);
      resolvedId = resolved.id;
      fileName = resolved.name || undefined;
    } catch {
      // Continuar con el id original
    }

    let buffer: Buffer | null = null;
    let apiError: string | undefined;

    try {
      const response = await this.driveClient.files.get(
        {
          fileId: resolvedId,
          alt: 'media',
          acknowledgeAbuse: true,
          ...DRIVE_FILE_OPTS,
        },
        { responseType: 'arraybuffer' },
      );
      buffer = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data as ArrayBuffer);
      if (isLikelyHtmlBuffer(buffer)) {
        throw new Error('API Drive devolvió HTML');
      }
    } catch (error: any) {
      apiError = error?.message || String(error);
      this.logger.warn(
        `Drive API alt=media falló fileId=${resolvedId}: ${apiError} — se intenta descarga pública`,
      );
    }

    if (!buffer || !buffer.length || isLikelyHtmlBuffer(buffer)) {
      try {
        buffer = await downloadPublicDriveFile(resolvedId);
      } catch (pubErr: any) {
        this.logger.error(
          `Error al descargar imagen Drive ${fileId}: API=${apiError || 'n/a'} público=${pubErr.message}`,
        );
        throw pubErr;
      }
    }

    const mimeType = assertImageBuffer(buffer, resolvedId);
    return { buffer, mimeType, fileName };
  }

  /**
   * Extrae el fileId de URLs típicas de Google Drive (archivo, no carpeta).
   */
  extractFileIdFromUrl(url: string): string | null {
    return extractDriveFileIdFromUrl(url);
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

  toDirectDownloadUrl(fileIdOrUrl: string): string {
    const fileId =
      this.extractFileIdFromUrl(fileIdOrUrl) || fileIdOrUrl.trim();
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  async downloadImageFromUrl(
    driveUrl: string,
  ): Promise<{
    buffer: Buffer;
    fileId: string;
    fileName: string;
    mimeType: string;
  }> {
    const fileId = this.extractFileIdFromUrl(driveUrl);
    if (!fileId) {
      throw new Error(
        `No se pudo extraer fileId de la URL de Drive: ${driveUrl}`,
      );
    }

    this.logger.log(`Descargando imagen de Drive por URL. fileId=${fileId}`);

    let fileName = `drive_${fileId}.jpg`;
    try {
      const meta = await this.getFileMetadata(fileId);
      if (meta.name) fileName = meta.name;
    } catch (metaErr: any) {
      this.logger.warn(
        `No se pudo leer metadata de Drive (${fileId}): ${metaErr.message}. Se usará nombre por defecto.`,
      );
    }

    const downloaded = await this.downloadImageFile(fileId);
    return {
      buffer: downloaded.buffer,
      fileId,
      fileName: downloaded.fileName || fileName,
      mimeType: downloaded.mimeType,
    };
  }
}
