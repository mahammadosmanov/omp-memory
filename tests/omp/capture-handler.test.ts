import { describe, expect, test } from "bun:test";
import { parseMemoryOperations } from "../../src/memory/capture";
import { handleCompletedTurn, type VerifiedCompletedTurn } from "../../src/omp/capture-handler";
import { CAPTURE_INSTRUCTION } from "../../src/omp/extension";
import type { MemoryRecord, VaultStore } from "../../src/memory/types";

const record: MemoryRecord = {
  id: "mem_12345678-1234-4234-8234-123456789abc",
  type: "lessons",
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
  provenance: "inferred",
  confidence: 0.9,
  content: "Validate candidates before persistence.",
};
const candidate = `## Memory candidate\n\`\`\`json\n${JSON.stringify([{ operation: "upsert", record }], null, 2)}\n\`\`\``;
const event = (content: unknown): VerifiedCompletedTurn => ({ type: "assistant_message", message: { content } });

function mockStore() {
  const writes: MemoryRecord[] = [];
  let reads = 0;
  const store: VaultStore = {
    async readAll() { reads++; return []; },
    async write(value) { writes.push(value); return "created"; },
  };
  return { store, writes, readCount: () => reads };
}

describe("OMP completed-turn memory capture", () => {
  test("uses one prompt example accepted by the visible-candidate parser", () => {
    const fences = [...CAPTURE_INSTRUCTION.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
    expect(fences).toHaveLength(1);
    const operations = parseMemoryOperations(`## Memory candidate\n\`\`\`json\n${fences[0]![1]}\n\`\`\``);
    expect(operations).toHaveLength(1);
    expect(operations[0]?.record.id).toMatch(/^mem_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(operations[0]?.record.createdAt).toBe("2026-10-14T10:00:00.000Z");
  });
  test("persists the candidate from a finalized response without a provider dependency", async () => {
    const { store, writes, readCount } = mockStore();
    const results = await handleCompletedTurn(event(`Here is the answer.\n\n${candidate}`), store);
    expect(results).toEqual([{ status: "created", id: record.id, type: record.type }]);
    expect(readCount()).toBe(1);
    expect(writes).toEqual([record]);
  });

  test("ignores candidate headings quoted inside variable-length Markdown fences", async () => {
    const { store, writes } = mockStore();
    const response = `~~~markdown\n## Memory candidate\n${candidate}\n~~~~\nOrdinary answer`;
    expect(await handleCompletedTurn(event(response), store)).toEqual([]);
    expect(writes).toHaveLength(0);
  });

  test("rejects ambiguous multiple live candidate sections", async () => {
    const { store, writes } = mockStore();
    const response = `${candidate}\n\n## Memory candidate\n${candidate.split("\n").slice(1).join("\n")}`;
    expect(await handleCompletedTurn(event(response), store)).toEqual([{ status: "failed", reason: "candidate-ambiguous" }]);
    expect(writes).toHaveLength(0);
  });

  test("absent or malformed visible candidates do not write or claim success", async () => {
    const { store, writes } = mockStore();
    expect(await handleCompletedTurn(event("Ordinary answer, no candidate."), store)).toEqual([]);
    expect(await handleCompletedTurn(event("## Memory candidate\nnot the required format"), store)).toEqual([{ status: "failed", reason: "candidate-invalid" }]);
    expect(writes).toHaveLength(0);
  });

  test("rejects unsupported response payload blocks without writing", async () => {
    const { store, writes } = mockStore();
    const unsupported = [{ type: "text", text: candidate }, { type: "image", data: "opaque" }];
    expect(await handleCompletedTurn(event(unsupported), store)).toEqual([{ status: "failed", reason: "unsupported-completion-payload" }]);
    expect(writes).toHaveLength(0);
  });

  test("unsupported path schema and failed writes never yield a saved result", async () => {
    const { store, writes } = mockStore();
    const bad = { ...record, id: "../outside" };
    const badCandidate = `## Memory candidate\n\`\`\`json\n${JSON.stringify([{ operation: "upsert", record: bad }])}\n\`\`\``;
    expect(await handleCompletedTurn(event(badCandidate), store)).toEqual([{ status: "failed", reason: "candidate-invalid" }]);
    expect(writes).toHaveLength(0);

    const failingStore: VaultStore = {
      async readAll() { return []; },
      async write() { throw new Error("disk unavailable"); },
    };
    expect(await handleCompletedTurn(event(candidate), failingStore)).toEqual([{ status: "failed", id: record.id, type: record.type, reason: "vault-write-failed" }]);
  });
});
