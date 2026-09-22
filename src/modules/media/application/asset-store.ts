/** Private byte storage. Authorization is checked by the repository before every read. */
export interface AssetStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
