import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
/** Development/local deployment adapter; all reads still require asset ownership in PostgreSQL. */
export class PrivateDiskStore {
  private directory: string;
  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }
  private file(key: string) {
    if (
      !/^[0-9a-f-]{36}\.(webp|mp4|png|jpg|jpeg)$/.test(key) &&
      !/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*\/[0-9a-f-]{36}\.(webp|mp4|png|jpg|jpeg)$/.test(key)
    )
      throw Error('INVALID_STORAGE_KEY');
    return path.join(this.directory, key);
  }
  async put(key: string, data: Buffer) {
    const filePath = this.file(key);
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, data, { flag: 'wx', mode: 0o600 });
  }
  async get(key: string) {
    return readFile(this.file(key));
  }
  async remove(key: string) {
    try {
      await unlink(this.file(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
