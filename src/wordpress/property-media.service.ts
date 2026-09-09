import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleDriveService } from '../google/google-drive.service';
import {
  extractDriveFolderIdFromCad,
  extractImageUrlsFromCad,
  MAX_PROPERTY_IMAGES,
} from './property-media-sources';
import type { RetellCad } from './property-mapper';
import { WordpressService } from './wordpress.service';

export type PropertyMediaResult = {
  featuredMediaId?: number;
  galleryMediaIds: number[];
};

type DriveFileRef = {
  id: string;
  name?: string | null;
  mimeType?: string | null;
};

/**
 * Drive → librería de medios WP → IDs de adjuntos para featured + galería WPResidence.
 */
@Injectable()
export class PropertyMediaService {
  private readonly logger = new Logger(PropertyMediaService.name);

  constructor(
    private readonly googleDrive: GoogleDriveService,
    private readonly wordpress: WordpressService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resuelve imágenes del CAD / carpeta Drive, las sube a /wp/v2/media y
   * devuelve IDs listos para featured_media + meta.property_images.
   */
  async resolveAndUploadPropertyMedia(
    cad: RetellCad | undefined,
    callId?: string,
    options: { postId?: number } = {},
  ): Promise<PropertyMediaResult> {
    const empty: PropertyMediaResult = { galleryMediaIds: [] };
    const driveFiles = await this.collectDriveImageFiles(cad, callId);

    if (driveFiles.length === 0) {
      this.logger.warn(
        `Sin imágenes Drive para call_id=${callId || 'n/a'} post=${options.postId || 'n/a'}`,
      );
      return empty;
    }

    const galleryMediaIds: number[] = [];
    for (const file of driveFiles.slice(0, MAX_PROPERTY_IMAGES)) {
      try {
        const buffer = await this.googleDrive.downloadImageBuffer(file.id);
        const mediaId = await this.wordpress.uploadMedia(
          buffer,
          file.name || `drive_${file.id}.jpg`,
          file.mimeType || 'image/jpeg',
          { postId: options.postId },
        );
        galleryMediaIds.push(mediaId);
      } catch (err: any) {
        this.logger.warn(
          `No se pudo subir Drive file=${file.id} (${file.name}): ${err.message}`,
        );
      }
    }

    if (galleryMediaIds.length === 0) {
      return empty;
    }

    this.logger.log(
      `Medios WP listos: ${galleryMediaIds.length} adjunto(s) → featured=${galleryMediaIds[0]} gallery=[${galleryMediaIds.join(',')}]`,
    );

    return {
      featuredMediaId: galleryMediaIds[0],
      galleryMediaIds,
    };
  }

  /**
   * Tras crear el post, asocia los adjuntos como hijos (galería WPResidence).
   */
  async attachGalleryToProperty(
    postId: number,
    mediaIds: number[],
  ): Promise<void> {
    for (const mediaId of mediaIds) {
      try {
        await this.wordpress.attachMediaToPost(mediaId, postId);
      } catch (err: any) {
        this.logger.warn(
          `No se pudo asociar media ${mediaId} → post ${postId}: ${err.message}`,
        );
      }
    }
  }

  private async collectDriveImageFiles(
    cad: RetellCad | undefined,
    callId?: string,
  ): Promise<DriveFileRef[]> {
    const seen = new Set<string>();
    const out: DriveFileRef[] = [];

    const pushUnique = (files: DriveFileRef[]) => {
      for (const f of files) {
        if (!f.id || seen.has(f.id)) continue;
        seen.add(f.id);
        out.push(f);
      }
    };

    // 1) URLs / IDs de archivo en el CAD (Sheet)
    for (const url of extractImageUrlsFromCad(cad)) {
      const fileId = this.googleDrive.extractFileIdFromUrl(url);
      if (!fileId) continue;
      try {
        const meta = await this.googleDrive.getFileMetadata(fileId);
        if (meta.mimeType?.startsWith('image/')) {
          pushUnique([
            {
              id: fileId,
              name: meta.name,
              mimeType: meta.mimeType,
            },
          ]);
        } else if (meta.mimeType === 'application/vnd.google-apps.folder') {
          const folderImages = await this.googleDrive.getImagesFromFolder(fileId);
          pushUnique(
            folderImages.map((f) => ({
              id: f.id!,
              name: f.name,
              mimeType: f.mimeType,
            })),
          );
        } else {
          // Intentar como imagen de todas formas (mime desconocido)
          pushUnique([{ id: fileId, name: meta.name, mimeType: meta.mimeType }]);
        }
      } catch {
        pushUnique([{ id: fileId, name: `drive_${fileId}.jpg`, mimeType: 'image/jpeg' }]);
      }
    }

    if (out.length >= MAX_PROPERTY_IMAGES) {
      return out.slice(0, MAX_PROPERTY_IMAGES);
    }

    // 2) Carpeta explícita del CAD / Sheet
    const folderFromCad = extractDriveFolderIdFromCad(cad);
    if (folderFromCad) {
      try {
        const images = await this.googleDrive.getImagesFromFolder(folderFromCad);
        this.logger.log(
          `Carpeta Drive CAD ${folderFromCad}: ${images.length} imagen(es)`,
        );
        pushUnique(
          images.map((f) => ({
            id: f.id!,
            name: f.name,
            mimeType: f.mimeType,
          })),
        );
      } catch (err: any) {
        this.logger.warn(
          `No se pudo listar carpeta Drive CAD ${folderFromCad}: ${err.message}`,
        );
      }
    }

    if (out.length >= MAX_PROPERTY_IMAGES) {
      return out.slice(0, MAX_PROPERTY_IMAGES);
    }

    // 3) Fallback: DRIVE_ROOT_FOLDER_ID (+ subcarpeta / archivos por call_id)
    const rootFolderId = this.config.get<string>('DRIVE_ROOT_FOLDER_ID');
    if (!rootFolderId || !callId) {
      return out.slice(0, MAX_PROPERTY_IMAGES);
    }

    try {
      const subfolderId = await this.googleDrive.findSubfolderByName(
        rootFolderId,
        callId,
      );
      if (subfolderId) {
        const images = await this.googleDrive.getImagesFromFolder(subfolderId);
        this.logger.log(
          `Subcarpeta Drive call_id=${callId} → ${images.length} imagen(es)`,
        );
        pushUnique(
          images.map((f) => ({
            id: f.id!,
            name: f.name,
            mimeType: f.mimeType,
          })),
        );
      }

      if (out.length === 0) {
        const named = await this.googleDrive.getImagesFromFolder(
          rootFolderId,
          callId,
        );
        pushUnique(
          named.map((f) => ({
            id: f.id!,
            name: f.name,
            mimeType: f.mimeType,
          })),
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Fallback Drive root/call_id falló (${callId}): ${err.message}`,
      );
    }

    return out.slice(0, MAX_PROPERTY_IMAGES);
  }
}
