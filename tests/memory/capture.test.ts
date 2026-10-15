import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMemoryOperations, persistMemoryOperations } from "../../src/memory/capture";
import { createVaultStore } from "../../src/memory/vault";
import type { MemoryRecord, VaultStore } from "../../src/memory/types";

const base: MemoryRecord = {
  id: "mem_12345678-1234-4234-8234-123456789abc",
  type: "rules",
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
  provenance: "explicit",
  content: "Keep responses concise.",
};
const candidate = (operations: unknown) => `## Memory candidate\n\`\`\`json\n${JSON.stringify(operations, null, 2)}\n\`\`\``;
const op = (record: MemoryRecord) => ({ operation: "upsert", record });
const roots: string[] = [];
async function vaultRoot() {
  const root = await mkdtemp(join(tmpdir(), "omp-capture-"));
  roots.push(root);
  return root;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("memory capture parser and persistence", () => {
  test("parses the visible JSON-fenced section and writes a valid note", async () => {
    const parsed = parseMemoryOperations(candidate([op(base)]));
    expect(parsed).toEqual([op(base)]);
    const store = createVaultStore(await vaultRoot());
    expect(await persistMemoryOperations(parsed, store)).toEqual([{ status: "created", id: base.id, type: base.type }]);
    expect(await store.readAll()).toEqual([base]);
  });

  test("rejects malformed syntax, unsupported operations, and invalid note/path fields", () => {
    expect(() => parseMemoryOperations(null)).toThrow();
    expect(() => parseMemoryOperations("## Memory candidate\nno operations" )).toThrow();
    expect(() => parseMemoryOperations(candidate([{ ...op(base), operation: "delete" }]))).toThrow();
    expect(() => parseMemoryOperations(candidate([op({ ...base, id: "../../outside" })]))).toThrow();
    expect(() => parseMemoryOperations(candidate([op({ ...base, extra: "not allowed" } as MemoryRecord)]))).toThrow();
  });

  test("explicit correction may supersede inferred record without changing stable identity", async () => {
    const inferred = { ...base, provenance: "inferred" as const, content: "Use long responses." };
    const store = await observedStore([inferred]);
    const corrected = { ...base, content: "Keep responses concise.", updatedAt: "2026-10-14T11:00:00.000Z" };
    expect(await persistMemoryOperations([op(corrected)], store)).toEqual([{ status: "updated", id: base.id, type: base.type }]);
    expect((await store.readAll())[0]).toEqual({ ...corrected, createdAt: inferred.createdAt });
  });

  test("conflicting explicit content is preserved and reported", async () => {
    const original = { ...base, content: "Keep responses concise." };
    const store = await observedStore([original]);
    const conflict = { ...original, content: "Always provide exhaustive responses.", updatedAt: "2026-10-14T11:00:00.000Z" };
    expect(await persistMemoryOperations([op(conflict)], store)).toEqual([{ status: "conflict", id: base.id, type: base.type, reason: "explicit-memory-conflict" }]);
    expect((await store.readAll())[0]).toEqual(original);
  });

  test("does not overwrite a different stable ID or replace explicit memory with inference", async () => {
    const original = { ...base, content: "Keep responses concise." };
    const store = await observedStore([original]);
    const differentId = { ...original, id: "mem_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", content: "Always be exhaustive." };
    expect(await persistMemoryOperations([op(differentId)], store)).toEqual([{ status: "created", id: differentId.id, type: differentId.type }]);
    const inferred = { ...original, provenance: "inferred" as const, content: "Use long responses." };
    expect(await persistMemoryOperations([op(inferred)], store)).toEqual([{ status: "conflict", id: base.id, type: base.type, reason: "explicit-memory-protected" }]);
  });

  test("does not overwrite or claim an equivalent inferred candidate over explicit memory", async () => {
    const explicit = { ...base, content: "Keep responses concise." };
    const store = await observedStore([explicit]);
    const inferred = { ...explicit, provenance: "inferred" as const };
    expect(await persistMemoryOperations([op(inferred)], store)).toEqual([]);
    expect((await store.readAll())[0]).toEqual(explicit);
  });

  test("requires a fresh vault read and surfaces read failures without writing", async () => {
    let writes = 0;
    const store: VaultStore = {
      async readAll() { throw new Error("bad vault"); },
      async write() { writes++; return "created"; },
    };
    expect(await persistMemoryOperations([op(base)], store)).toEqual([{ status: "failed", id: base.id, type: base.type, reason: "vault-read-failed" }]);
    expect(writes).toBe(0);
  });
});

async function observedStore(records: MemoryRecord[]): Promise<VaultStore> {
  const root = await vaultRoot();
  const store = createVaultStore(root);
  for (const record of records) await store.write(record);
  await store.readAll();
  return store;
}
