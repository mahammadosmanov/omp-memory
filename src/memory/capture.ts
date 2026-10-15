import { serializeMemoryNote } from "./note-codec";
import type { MemoryRecord, MemoryType, VaultStore } from "./types";

const RECORD_FIELDS: Record<string, true> = {
  id: true,
  type: true,
  createdAt: true,
  updatedAt: true,
  provenance: true,
  confidence: true,
  status: true,
  content: true,
};

export interface MemoryOperation {
  operation: "upsert";
  record: MemoryRecord;
}

export type CaptureResult =
  | { status: "created" | "updated"; id: string; type: MemoryType }
  | { status: "conflict"; id: string; type: MemoryType; reason: string }
  | { status: "failed"; id?: string; type?: MemoryType; reason: string };

function invalid(message: string): never {
  throw new Error(`Invalid memory candidate: ${message}`);
}

/**
 * Candidate syntax is one visible `## Memory candidate` section containing
 * exactly one fenced `json` array of `{ operation: "upsert", record }` objects.
 */
export function parseMemoryOperations(payload: unknown): MemoryOperation[] {
  if (typeof payload !== "string") invalid("section must be text");
  const match = /^## Memory candidate\s*\r?\n\s*```json\s*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(payload.trim());
  if (!match) invalid("expected a Memory candidate heading and one JSON fence");
  let decoded: unknown;
  try {
    decoded = JSON.parse(match[1]!);
  } catch {
    invalid("JSON is malformed");
  }
  if (!Array.isArray(decoded)) invalid("JSON body must be an array");
  return decoded.map((value: unknown, index: number) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`operation ${index} must be an object`);
    const item = value as Record<string, unknown>;
    if (Object.keys(item).sort().join(",") !== "operation,record" || item.operation !== "upsert") invalid(`operation ${index} has unsupported fields or type`);
    if (!item.record || typeof item.record !== "object" || Array.isArray(item.record)) invalid(`operation ${index} record must be an object`);
    const record = item.record as MemoryRecord;
    if (Object.keys(record).some((key) => !Object.hasOwn(RECORD_FIELDS, key))) invalid(`operation ${index} record has unsupported fields`);
    try {
      // The canonical note codec is the schema authority for IDs, timestamps,
      // enum values, and content; the field allowlist prevents lossy stripping.
      serializeMemoryNote(record);
    } catch {
      invalid(`operation ${index} record failed note validation`);
    }
    return { operation: "upsert", record };
  });
}

/** Apply validated operations only against a freshly observed vault snapshot. */
export async function persistMemoryOperations(operations: MemoryOperation[], store: VaultStore): Promise<CaptureResult[]> {
  let existing: MemoryRecord[];
  try {
    existing = await store.readAll();
  } catch {
    return operations.map(({ record }) => ({ status: "failed", id: record.id, type: record.type, reason: "vault-read-failed" }));
  }

  const byId = new Map(existing.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const results: CaptureResult[] = [];
  for (const { record } of operations) {
    if (seen.has(record.id)) {
      results.push({ status: "conflict", id: record.id, type: record.type, reason: "duplicate-candidate-id" });
      continue;
    }
    seen.add(record.id);
    const prior = byId.get(record.id);
    if (prior) {
      if (prior.type !== record.type) {
        results.push({ status: "conflict", id: record.id, type: prior.type, reason: "id-category-mismatch" });
        continue;
      }
      if (prior.provenance === "explicit" && record.provenance === "inferred") {
        if (prior.content === record.content) continue;
        results.push({ status: "conflict", id: record.id, type: record.type, reason: "explicit-memory-protected" });
        continue;
      }
      if (prior.provenance === "explicit" && record.provenance === "explicit" && prior.content !== record.content) {
        results.push({ status: "conflict", id: record.id, type: record.type, reason: "explicit-memory-conflict" });
        continue;
      }
      // An explicit correction with the same stable ID may supersede an
      // inference. Preserve the original creation timestamp and stable ID.
      const update: MemoryRecord = {
        ...record,
        id: prior.id,
        createdAt: prior.createdAt,
      };
      try {
        const result = await store.write(update);
        results.push(result === "conflict"
          ? { status: "conflict", id: record.id, type: record.type, reason: "vault-write-conflict" }
          : { status: result, id: record.id, type: record.type });
        if (result === "updated") byId.set(record.id, update);
      } catch {
        results.push({ status: "failed", id: record.id, type: record.type, reason: "vault-write-failed" });
      }
      continue;
    }
    try {
      const result = await store.write(record);
      results.push(result === "conflict"
        ? { status: "conflict", id: record.id, type: record.type, reason: "vault-write-conflict" }
        : { status: result, id: record.id, type: record.type });
      if (result === "created") byId.set(record.id, record);
    } catch {
      results.push({ status: "failed", id: record.id, type: record.type, reason: "vault-write-failed" });
    }
  }
  return results;
}
