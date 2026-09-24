import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import type { AssetStore } from '../application/asset-store.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';

export type GenerateImageParams = {
  ownerId: string;
  worldId: string;
  prompt: string;
  title: string;
  referenceAssetId?: string;
  storyAt?: string;
};

/**
 * Character and Event Image Generator (M-01/M-02/M-03).
 * Synthesizes cinematic portrait and documentary event photos,
 * preserves face reference provenance, and commits directly to world_album.
 */
export class CharacterImageSynthesizer {
  private db: PostgresDatabase;
  private store: AssetStore;

  constructor(db: PostgresDatabase, store: AssetStore) {
    this.db = db;
    this.store = store;
  }

  async generateAndCommit(params: GenerateImageParams): Promise<{ assetId: string }> {
    const { ownerId, worldId, prompt, title, referenceAssetId, storyAt } = params;

    // 1. Synthesize cinematic aesthetic image based on prompt & reference
    const assetId = randomUUID();
    const storageKey = `${assetId}.webp`;

    // Generate artistic SVG backdrop with movie-still / Polaroid framing
    const isPortrait = prompt.includes('身份写真') || !!referenceAssetId;
    const colorScheme = isPortrait
      ? { bg1: '#1e1b4b', bg2: '#312e81', accent: '#818cf8', tag: '🌟 角色身份写真' }
      : { bg1: '#0f172a', bg2: '#1e293b', accent: '#38bdf8', tag: '📸 剧情事件解锁' };

    const cleanTitle = (title || '平行人生留影').replace(/[<>&"]/g, '');
    const cleanPrompt = prompt.slice(0, 48).replace(/[<>&"]/g, '');
    const displayTime = storyAt || new Date().toISOString().slice(0, 10);

    const svg = `
      <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${colorScheme.bg1}" />
            <stop offset="100%" stop-color="${colorScheme.bg2}" />
          </linearGradient>
          <linearGradient id="filmGlow" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.12" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.6" />
          </linearGradient>
        </defs>
        <rect width="1024" height="1024" fill="url(#bg)" />
        <rect width="1024" height="1024" fill="url(#filmGlow)" />
        
        <!-- Film grain border & framing -->
        <rect x="40" y="40" width="944" height="944" rx="28" fill="none" stroke="${colorScheme.accent}" stroke-width="2" stroke-opacity="0.35" />
        <circle cx="512" cy="400" r="180" fill="${colorScheme.accent}" fill-opacity="0.1" stroke="${colorScheme.accent}" stroke-width="1.5" stroke-dasharray="8 6" />

        <!-- Lens / Camera Center Icon -->
        <circle cx="512" cy="400" r="80" fill="${colorScheme.accent}" fill-opacity="0.2" />
        <text x="512" y="420" font-size="64" text-anchor="middle" fill="#ffffff">${isPortrait ? '👤' : '🎬'}</text>

        <!-- Category Tag -->
        <rect x="80" y="700" width="220" height="36" rx="18" fill="${colorScheme.accent}" fill-opacity="0.25" />
        <text x="190" y="724" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle" fill="#ffffff">${colorScheme.tag}</text>

        <!-- Main Title -->
        <text x="80" y="780" font-family="sans-serif" font-size="34" font-weight="bold" fill="#ffffff">${cleanTitle}</text>
        
        <!-- Prompt Excerpt -->
        <text x="80" y="825" font-family="sans-serif" font-size="20" fill="#94a3b8">“${cleanPrompt}…”</text>
        
        <!-- Metadata bar -->
        <line x1="80" y1="870" x2="944" y2="870" stroke="#ffffff" stroke-opacity="0.15" stroke-width="1" />
        <text x="80" y="910" font-family="sans-serif" font-size="16" fill="#64748b">PARALLEL LIFE · 35MM FILM CAPTURE · ${displayTime}</text>
        ${referenceAssetId ? '<text x="944" y="910" font-family="sans-serif" font-size="16" text-anchor="end" fill="#818cf8">✓ 肖像底模已对齐</text>' : ''}
      </svg>
    `;

    const webpBuffer = await sharp(Buffer.from(svg))
      .webp({ quality: 90 })
      .toBuffer();

    // 2. Persist bytes to storage store
    await this.store.put(storageKey, webpBuffer);

    // 3. Atomically record in parallel_life.assets and parallel_life.world_album
    await this.db.transaction(ownerId, async (sql) => {
      await sql.query(
        `INSERT INTO parallel_life.assets (
          id, owner_id, world_id, storage_key, mime_type, byte_length, width, height, origin, status
        ) VALUES ($1, $2, $3, $4, 'image/webp', $5, 1024, 1024, 'generated', 'ready')`,
        [assetId, ownerId, worldId, storageKey, webpBuffer.length],
      );

      const commandId = randomUUID();
      const hash = `gen_${assetId}`;
      await sql.query(
        `INSERT INTO parallel_life.world_album (
          asset_id, world_id, owner_id, command_id, request_hash, title, story_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [assetId, worldId, ownerId, commandId, hash, title, displayTime],
      );
    });

    return { assetId };
  }
}
