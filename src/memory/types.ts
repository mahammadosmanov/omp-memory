export const MEMORY_TYPES = ["preferences", "rules", "decisions", "corrections", "lessons", "projects"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];
export type MemoryProvenance = "explicit" | "inferred";
export type MemoryStatus = "active" | "superseded";

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  createdAt: string;
  updatedAt: string;
  provenance: MemoryProvenance;
  confidence?: number;
  status?: MemoryStatus;
  content: string;
}

export interface VaultStore {
  readAll(): Promise<MemoryRecord[]>;
  write(record: MemoryRecord, expectedContentHash?: string): Promise<"created" | "updated" | "conflict">;
}
