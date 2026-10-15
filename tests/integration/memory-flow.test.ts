import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleCompletedTurn } from "../../src/omp/capture-handler";
import { injectMemoryContext } from "../../src/omp/context-handler";
import { notifyMemoryResult } from "../../src/omp/notifications";
import type { ExtensionContext } from "../../src/omp/extension";
import { serializeMemoryNote } from "../../src/memory/note-codec";
import { createVaultStore } from "../../src/memory/vault";
import type { MemoryRecord } from "../../src/memory/types";

const record: MemoryRecord = {
  id: "mem_12345678-1234-4234-8234-123456789abc",
  type: "lessons",
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
  provenance: "explicit",
  content: "For synthetic astronomy summaries, use metric units.",
};
const unrelatedRecord: MemoryRecord = {
  id: "mem_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  type: "lessons",
  createdAt: "2026-10-14T09:00:00.000Z",
  updatedAt: "2026-10-14T09:00:00.000Z",
  provenance: "inferred",
  content: "For botany, use imperial units.",
};

const transcriptSentinel = "SYNTHETIC-TRANSCRIPT-SENTINEL-7f3a9c";
const candidate = `## Memory candidate\n\`\`\`json\n${JSON.stringify([{ operation: "upsert", record }])}\n\`\`\``;
const roots: string[] = [];

async function temporaryVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omp-memory-flow-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});


describe("memory lifecycle integration", () => {
  test("keeps public example vault free of memory notes", async () => {
    const publicExampleEntries = await readdir(join(import.meta.dir, "../../examples/vault"));
    expect(publicExampleEntries).toEqual([".gitkeep"]);
    expect(await readFile(join(import.meta.dir, "../../examples/vault/.gitkeep"), "utf8")).toBe("");
  });

  test("persists only a candidate, reports locally, retrieves edits, respects deletion and reopens Markdown", async () => {
    const root = await temporaryVault();
    const store = createVaultStore(root);
    await store.write(unrelatedRecord);
    const finalizedTurn = {
      type: "assistant_message" as const,
      message: { content: `Synthetic visible answer mentioning ${transcriptSentinel}.\n\n${candidate}` },
    };

    const results = await handleCompletedTurn(finalizedTurn, store);
    expect(results).toEqual([{ status: "created", id: record.id, type: record.type }]);
    const markdownPath = join(root, record.type, `${record.id}.md`);
    const savedMarkdown = await readFile(markdownPath, "utf8");
    expect(savedMarkdown).toContain(record.content);
    expect(savedMarkdown).not.toContain(transcriptSentinel);
    expect(savedMarkdown).not.toContain("Synthetic visible answer");

    const notices: string[] = [];
    const localUI: ExtensionContext = {
      hasUI: true,
      ui: { notify: (message) => notices.push(message) },
    };
    for (const result of results) notifyMemoryResult(localUI, result);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(`${record.type}/${record.id}`);
    expect(notices[0]).not.toContain(record.content);

    const laterRequest = {
      type: "context" as const,
      messages: [{ role: "user", content: "Prepare a synthetic astronomy summary." }],
    };
    const injected = await injectMemoryContext(laterRequest, store);
    expect(injected.messages).toHaveLength(2);
    expect(injected.messages[1]?.content).toContain("BEGIN UNTRUSTED OMP MEMORY DATA");
    expect(injected.messages[1]?.content).toContain(record.content);
    expect(injected.messages[1]?.content).not.toContain(unrelatedRecord.content);
    expect(injected.messages[0]).toEqual(laterRequest.messages[0]);

    const externallyEdited = { ...record, content: "For synthetic astronomy summaries, use kilometers." };
    await writeFile(markdownPath, serializeMemoryNote(externallyEdited));
    const afterEdit = await injectMemoryContext(laterRequest, createVaultStore(root));
    expect(afterEdit.messages[1]?.content).toContain(externallyEdited.content);
    expect(afterEdit.messages[1]?.content).not.toContain(record.content);

    await rm(markdownPath);
    const afterDelete = await injectMemoryContext(laterRequest, createVaultStore(root));
    expect(afterDelete).toEqual(laterRequest);
    expect(await createVaultStore(root).readAll()).toEqual([unrelatedRecord]);
  });
});
