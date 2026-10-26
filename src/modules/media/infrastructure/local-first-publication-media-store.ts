import { timingSafeEqual } from 'node:crypto';
import type {
  PublicationMediaStore,
  PublicationMediaMime,
} from '../../settings/infrastructure/publication-media-repository.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
import { PrivateDiskStore } from './private-disk-store.ts';

const keyPattern =
  /^works\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp|mp4)$/;
const mime: Record<string, PublicationMediaMime> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
};
export function publicationLocalStorageEnabled(config: {
  vercel?: string;
  origin?: string;
  directory?: string;
}) {
  if (config.vercel || !config.directory || !config.origin) return false;
  try {
    const u = new URL(config.origin);
    return (
      ['http:', 'https:'].includes(u.protocol) &&
      (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
        u.hostname.endsWith('.localhost'))
    );
  } catch {
    return false;
  }
}
/** Only loopback server composition selects this adapter. No public filesystem URL. */
export class LocalFirstPublicationMediaStore implements PublicationMediaStore {
  private readonly disk: PrivateDiskStore;
  private readonly remote?: PublicationMediaStore;
  constructor(
    directory: string,
    remote?: PublicationMediaStore,
  ) {
    this.disk = new PrivateDiskStore(directory);
    this.remote = remote;
  }
  private validate(key: string) {
    const m = keyPattern.exec(key);
    if (!m) throw new TaskError('INVALID_INPUT');
    return m;
  }
  async signUpload(key: string) {
    const [, work, asset] = this.validate(key);
    // This is an authenticated same-origin upload, not a bearer credential.
    return {
      uploadUrl: `/api/v1/publisher/works/${work}/media/${asset}/content`,
      uploadToken: 'local-session',
    };
  }
  async readStored(key: string): Promise<Buffer | undefined> {
    this.validate(key);
    try {
      return await this.disk.get(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async put(key: string, bytes: Buffer) {
    this.validate(key);
    try {
      await this.disk.put(key, bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const previous = await this.disk.get(key);
      if (previous.length !== bytes.length || !timingSafeEqual(previous, bytes))
        throw new TaskError('IDEMPOTENCY_CONFLICT');
    }
  }
  async inspect(key: string) {
    const match = this.validate(key);
    const bytes = await this.readStored(key);
    if (!bytes) {
      if (this.remote) return this.remote.inspect(key);
      throw new TaskError('INVALID_STATE');
    }
    return {
      byteLength: bytes.length,
      mimeType: mime[match[3]!]!,
      header: new Uint8Array(bytes.subarray(0, 4096)),
    };
  }
  async signRead(key: string) {
    this.validate(key);
    if (!this.remote) throw new TaskError('NOT_FOUND');
    return this.remote.signRead(key);
  }
}
