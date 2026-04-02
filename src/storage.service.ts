import fs from "fs/promises";
import path from "path";

export interface StoredObject {
  storageKey: string;
  sizeBytes: number;
  contentType: string;
}

export interface StorageService {
  put(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObject>;

  getAbsolutePath(key: string): string;
}

export class LocalStorageService implements StorageService {
  constructor(private readonly baseDir: string) {}

  async put(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObject> {
    const absolutePath = this.getAbsolutePath(params.key);
    const dir = path.dirname(absolutePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(absolutePath, params.body);

    return {
      storageKey: params.key,
      sizeBytes: params.body.length,
      contentType: params.contentType,
    };
  }

  getAbsolutePath(key: string): string {
    return path.join(this.baseDir, key);
  }
}