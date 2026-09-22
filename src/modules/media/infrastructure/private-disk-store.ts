import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
/** Development/local deployment adapter; all reads still require asset ownership in PostgreSQL. */
export class PrivateDiskStore {
  private directory: string;
  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }
  private file(key: string) {
    if (!/^[0-9a-f-]{36}\.webp$/.test(key)) throw Error('INVALID_STORAGE_KEY');
    return path.join(this.directory, key);
  }
  async put(key: string, data: Buffer) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(this.file(key), data, { flag: 'wx', mode: 0o600 });
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
