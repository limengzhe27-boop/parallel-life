import type { AssetStore } from '../application/asset-store.ts';

/** Local bytes retain the same storage key; authorization remains in AssetRepository. */
export class LocalFirstAssetStore implements AssetStore {
  private readonly local: AssetStore;
  private readonly remote: AssetStore;
  constructor(local: AssetStore, remote: AssetStore) {
    this.local = local;
    this.remote = remote;
  }

  put(key: string, data: Buffer): Promise<void> {
    return this.local.put(key, data);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await this.local.get(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return this.remote.get(key);
    }
  }

  async remove(key: string): Promise<void> {
    await this.local.remove(key);
    await this.remote.remove(key);
  }
}
