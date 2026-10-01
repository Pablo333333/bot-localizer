import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { drive, drive_v3 } from '@googleapis/drive';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import {
  assertImageBuffer,
  downloadPublicDriveFile,
  driveResourceKeyHeader,
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
    resourceKey?: string | null,
  ): Promise<drive_v3.Schema$File[]> {
    try {
      const safeTerm = searchTerm
        ? String(searchTerm).replace(/'/g, "\\'")
        : undefined;
      let query = `'${folderId}' in parents and (mimeType contains 'image/') and trashed = false`;
      if (safeTerm) {
        query += ` and name contains '${safeTerm}'`;
      }

      const response = await this.driveClient.files.list(
        {
          q: query,
          fields: 'files(id, name, mimeType, resourceKey)',
          orderBy: 'name',
          pageSize: 100,
          ...DRIVE_LIST_OPTS,
        },
        driveResourceKeyHeader(folderId, resourceKey),
      );

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
   * `Localizados_Images/image_80.jpg` → archivo dentro de la carpeta con ese nombre.
   * Si hay carpeta raíz (la del enlace o DRIVE_ROOT), busca ahí primero.
   */
  async findImageByRelativePath(
    relativePath: string,
    access?: { parentFolderId?: string; resourceKey?: string | null },
  ): Promise<{
    id: string;
    name?: string | null;
    mimeType?: string | null;
    resourceKey?: string | null;
  } | null> {
    const scoped = await this.findImageInsideFolder(relativePath, access);
    if (scoped) return scoped;
    return this.findImageByNameAnywhere(relativePath);
  }

  private async findImageInsideFolder(
    relativePath: string,
    access?: { parentFolderId?: string; resourceKey?: string | null },
  ): Promise<{
    id: string;
    name?: string | null;
    mimeType?: string | null;
    resourceKey?: string | null;
  } | null> {
    const parentId = String(access?.parentFolderId || '').trim();
    if (!parentId) return null;
    const parts = String(relativePath || '')
      .trim()
      .replace(/\\/g, '/')
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;
    const fileName = parts[parts.length - 1].replace(/'/g, "\\'");
    const folderName =
      parts.length >= 2 ? parts[parts.length - 2].replace(/'/g, "\\'") : '';
    if (!fileName) return null;
    const parentKey = access?.resourceKey;

    try {
      let searchFolderId = parentId;
      let searchKey = parentKey;
      if (folderName) {
        const folders = await this.driveClient.files.list(
          {
            q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and trashed = false`,
            fields: 'files(id, name, resourceKey)',
            pageSize: 5,
            ...DRIVE_LIST_OPTS,
          },
          driveResourceKeyHeader(parentId, parentKey),
        );
        const folder = folders.data.files?.[0];
        if (folder?.id) {
          searchFolderId = folder.id;
          searchKey = folder.resourceKey || parentKey;
        }
      }

      const files = await this.driveClient.files.list(
        {
          q: `'${searchFolderId}' in parents and name = '${fileName}' and trashed = false`,
          fields: 'files(id, name, mimeType, resourceKey)',
          pageSize: 5,
          ...DRIVE_LIST_OPTS,
        },
        driveResourceKeyHeader(searchFolderId, searchKey),
      );
      const file = files.data.files?.[0];
      if (!file?.id) return null;
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        resourceKey: file.resourceKey || searchKey,
      };
    } catch (error: any) {
      this.logger.warn(
        `No se pudo buscar ${relativePath} en ${parentId}: ${error.message}`,
      );
      return null;
    }
  }

  private async findImageByNameAnywhere(relativePath: string): Promise<{
    id: string;
    name?: string | null;
    mimeType?: string | null;
  } | null> {
    const parts = String(relativePath || '')
      .trim()
      .replace(/\\/g, '/')
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 2) return null;
    const fileName = parts[parts.length - 1].replace(/'/g, "\\'");
    const folderName = parts[parts.length - 2].replace(/'/g, "\\'");
    if (!fileName || !folderName) return null;

    try {
      const folders = await this.driveClient.files.list({
        q: `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 10,
        ...DRIVE_LIST_OPTS,
      });
      for (const folder of folders.data.files || []) {
        if (!folder.id) continue;
        const files = await this.driveClient.files.list({
          q: `'${folder.id}' in parents and name = '${fileName}' and trashed = false`,
          fields: 'files(id, name, mimeType)',
          pageSize: 5,
          ...DRIVE_LIST_OPTS,
        });
        const file = files.data.files?.[0];
        if (file?.id) {
          return {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
          };
        }
      }
      return null;
    } catch (error: any) {
      this.logger.warn(
        `No se pudo resolver ${folderName}/${fileName}: ${error.message}`,
      );
      return null;
    }
  }

  async findSubfolderByName(
    parentFolderId: string,
    nameContains: string,
    resourceKey?: string | null,
  ): Promise<string | null> {
    const safeTerm = String(nameContains || '')
      .trim()
      .replace(/'/g, "\\'");
    if (!safeTerm) return null;

    try {
      const response = await this.driveClient.files.list(
        {
          q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name contains '${safeTerm}' and trashed = false`,
          fields: 'files(id, name)',
          pageSize: 10,
          ...DRIVE_LIST_OPTS,
        },
        driveResourceKeyHeader(parentFolderId, resourceKey),
      );
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
    resourceKey?: string | null,
  ): Promise<{
    id: string;
    name?: string | null;
    mimeType?: string | null;
    shortcutTargetId?: string | null;
  }> {
    const meta = await this.driveClient.files.get(
      {
        fileId,
        fields: 'id, name, mimeType, shortcutDetails, resourceKey',
        ...DRIVE_FILE_OPTS,
      },
      driveResourceKeyHeader(fileId, resourceKey),
    );
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
  async resolveImageFileId(
    fileId: string,
    resourceKey?: string | null,
  ): Promise<{
    id: string;
    name?: string | null;
    mimeType?: string | null;
  }> {
    const meta = await this.getFileMetadata(fileId, resourceKey);
    if (
      meta.mimeType === 'application/vnd.google-apps.shortcut' &&
      meta.shortcutTargetId
    ) {
      this.logger.log(
        `Drive shortcut ${fileId} → target ${meta.shortcutTargetId}`,
      );
      return this.getFileMetadata(meta.shortcutTargetId, resourceKey);
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
    resourceKey?: string | null,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName?: string }> {
    let resolvedId = fileId;
    let fileName: string | undefined;
    try {
      const resolved = await this.resolveImageFileId(fileId, resourceKey);
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
        {
          responseType: 'arraybuffer',
          ...driveResourceKeyHeader(resolvedId, resourceKey),
        },
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
