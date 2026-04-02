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