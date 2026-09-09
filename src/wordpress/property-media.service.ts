import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleDriveService } from '../google/google-drive.service';
import {
  extractDriveFolderIdsFromCad,
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
    const driveFiles = await this.collectDriveImageFiles(cad, callId, options.postId);

    if (driveFiles.length === 0) {
      this.logger.warn(
        `[PropertyMedia] Sin imágenes Drive | call_id=${callId || 'n/a'} post=${options.postId || 'n/a'} url_imagen=${String(cad?.url_imagen || '').slice(0, 80)} carpeta=${String(cad?.carpeta_drive || '').slice(0, 80)}`,
      );
      return empty;
    }

    this.logger.log(
      `[PropertyMedia] ${driveFiles.length} archivo(s) Drive a subir → WP post=${options.postId || 'nuevo'}`,
    );

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
        this.logger.log(
          `[PropertyMedia] OK media_id=${mediaId} drive=${file.id} name=${file.name}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `[PropertyMedia] Fallo subir Drive file=${file.id} (${file.name}): ${err.message}`,
        );
      }
    }

    if (galleryMediaIds.length === 0) {
      this.logger.error(
        `[PropertyMedia] Había ${driveFiles.length} archivo(s) Drive pero ninguna subida a WP tuvo éxito`,
      );
      return empty;
    }

    this.logger.log(
      `[PropertyMedia] Listo: featured=${galleryMediaIds[0]} gallery=[${galleryMediaIds.join(',')}]`,
    );

    return {
      featuredMediaId: galleryMediaIds[0],
      galleryMediaIds,
    };
  }

  /**
   * Asocia adjuntos como hijos del estate_property (galería WPResidence).
   * Llamar siempre tras upsert (create y update).
   */
  async attachGalleryToProperty(
    postId: number,
    mediaIds: number[],
  ): Promise<void> {
    for (const mediaId of mediaIds) {
      try {
        await this.wordpress.attachMediaToPost(mediaId, postId);
        this.logger.log(
          `[PropertyMedia] Adjunto ${mediaId} → post_parent=${postId}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `[PropertyMedia] No se pudo asociar media ${mediaId} → post ${postId}: ${err.message}`,
        );
      }
    }
  }

  private async collectDriveImageFiles(
    cad: RetellCad | undefined,
    callId?: string,
    postId?: number,
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
    const fileUrls = extractImageUrlsFromCad(cad);
    this.logger.log(
      `[PropertyMedia] Fuentes URL archivo: ${fileUrls.length} | carpetas CAD: ${extractDriveFolderIdsFromCad(cad).join(',') || '-'}`,
    );

    for (const url of fileUrls) {
      const fileId = this.googleDrive.extractFileIdFromUrl(url);
      if (!fileId) {
        this.logger.warn(`[PropertyMedia] URL sin fileId (¿carpeta?): ${url}`);
        continue;
      }
      try {
        const meta = await this.googleDrive.getFileMetadata(fileId);
        if (meta.mimeType?.startsWith('image/')) {
          pushUnique([
            { id: fileId, name: meta.name, mimeType: meta.mimeType },
          ]);
        } else if (meta.mimeType === 'application/vnd.google-apps.folder') {
          const folderImages =
            await this.googleDrive.getImagesFromFolder(fileId);
          pushUnique(
            folderImages.map((f) => ({
              id: f.id!,
              name: f.name,
              mimeType: f.mimeType,
            })),
          );
        } else {
          pushUnique([
            { id: fileId, name: meta.name, mimeType: meta.mimeType },
          ]);
        }
      } catch (err: any) {
        this.logger.warn(
          `[PropertyMedia] Metadata Drive falló ${fileId}: ${err.message} — se intenta descarga directa`,
        );
        pushUnique([
          { id: fileId, name: `drive_${fileId}.jpg`, mimeType: 'image/jpeg' },
        ]);
      }
    }

    if (out.length >= MAX_PROPERTY_IMAGES) {
      return out.slice(0, MAX_PROPERTY_IMAGES);
    }

    // 2) Carpetas explícitas (columna + URLs /folders/ en campos imagen)
    for (const folderId of extractDriveFolderIdsFromCad(cad)) {
      try {
        const images = await this.googleDrive.getImagesFromFolder(folderId);
        this.logger.log(
          `[PropertyMedia] Carpeta ${folderId}: ${images.length} imagen(es)`,
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
          `[PropertyMedia] No se pudo listar carpeta ${folderId}: ${err.message}`,
        );
      }
    }

    if (out.length >= MAX_PROPERTY_IMAGES) {
      return out.slice(0, MAX_PROPERTY_IMAGES);
    }

    // 3) Fallback: DRIVE_ROOT_FOLDER_ID por call_id y/o postId
    const rootFolderId = this.config.get<string>('DRIVE_ROOT_FOLDER_ID');
    const searchTerms = [callId, postId ? String(postId) : '']
      .map((s) => String(s || '').trim())
      .filter(Boolean);

    if (!rootFolderId || searchTerms.length === 0) {
      if (!rootFolderId) {
        this.logger.warn(
          '[PropertyMedia] DRIVE_ROOT_FOLDER_ID vacío — sin fallback por carpeta raíz',
        );
      }
      return out.slice(0, MAX_PROPERTY_IMAGES);
    }

    try {
      for (const term of searchTerms) {
        if (out.length > 0) break;
        const subfolderId = await this.googleDrive.findSubfolderByName(
          rootFolderId,
          term,
        );
        if (subfolderId) {
          const images =
            await this.googleDrive.getImagesFromFolder(subfolderId);
          this.logger.log(
            `[PropertyMedia] Subcarpeta term=${term} → ${images.length} imagen(es)`,
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
            term,
          );
          this.logger.log(
            `[PropertyMedia] Archivos en root name~${term}: ${named.length}`,
          );
          pushUnique(
            named.map((f) => ({
              id: f.id!,
              name: f.name,
              mimeType: f.mimeType,
            })),
          );
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `[PropertyMedia] Fallback root falló (${searchTerms.join(',')}): ${err.message}`,
      );
    }

    return out.slice(0, MAX_PROPERTY_IMAGES);
  }
}
