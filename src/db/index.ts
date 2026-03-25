import Dexie, { type EntityTable } from "dexie";

export type FileKind = "image" | "pdf";

export interface IndexedFile {
  id: string;
  relativePath: string;
  absolutePath: string;
  name: string;
  parentPath: string;
  mtimeMs: number;
  size: number;
  kind: FileKind;
  tags: string[];
}

export class QualificationDB extends Dexie {
  files!: EntityTable<IndexedFile, "id">;

  constructor() {
    super("qualification-mgmt");
    this.version(1).stores({
      files: "id, name, relativePath, parentPath, mtimeMs, kind",
    });
  }
}

export const db = new QualificationDB();
