import { describe, expect, test } from "bun:test";
import { memoryContextBlock, selectMemories } from "../../src/memory/retrieval";
import type { MemoryRecord } from "../../src/memory/types";

const record = (overrides: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "content">): MemoryRecord => ({
  id: overrides.id,
  type: overrides.type ?? "lessons",
  createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
  provenance: overrides.provenance ?? "inferred",
  ...(overrides.confidence === undefined ? {} : { confidence: overrides.confidence }),
  ...(overrides.status === undefined ? {} : { status: overrides.status }),
  content: overrides.content,
});

describe("memory retrieval ranking and budget", () => {
  test("ranks relevant notes ahead of unrelated notes", () => {
    const notes = [
      record({ id: "unrelated", content: "Prefer concise answers." }),
      record({ id: "relevant", content: "Rust compiler errors should be fixed before running tests." }),
    ];
    expect(selectMemories("debug Rust compiler errors", notes, 12, 6000).map(({ id }) => id)).toEqual(["relevant"]);
  });

  test("uses explicit priority, recency, and codepoint ID order after relevance", () => {
    const notes = [
      record({ id: "z-inferred", content: "Use Rust for the compiler.", updatedAt: "2026-10-13T00:00:00.000Z" }),
      record({ id: "old", type: "rules", provenance: "explicit", content: "Use Rust for the compiler.", updatedAt: "2026-01-01T00:00:00.000Z" }),
      record({ id: "z-new", type: "decisions", provenance: "explicit", content: "Use Rust for the compiler.", updatedAt: "2026-10-13T00:00:00.000Z" }),
      record({ id: "a-new", type: "rules", provenance: "explicit", content: "Use Rust for the compiler.", updatedAt: "2026-10-13T00:00:00.000Z" }),
      record({ id: "a-Rust", content: "Use Rust for the compiler.", updatedAt: "2026-10-13T00:00:00.000Z" }),
      record({ id: "A-Rust", content: "Use Rust for the compiler.", updatedAt: "2026-10-13T00:00:00.000Z" }),
    ];
    expect(selectMemories("RUST compiler", notes, 12, 6000).map(({ id }) => id)).toEqual([
      "a-new", "z-new", "old", "A-Rust", "a-Rust", "z-inferred",
    ]);
  });

  test("keeps explicit global rules and preferences eligible, but excludes unrelated scoped notes", () => {
    const notes = [
      record({ id: "global-rule", type: "rules", provenance: "explicit", content: "Keep answers concise." }),
      record({ id: "global-preference", type: "preferences", provenance: "explicit", content: "Use a warm tone." }),
      record({ id: "scoped-unrelated", type: "lessons", provenance: "explicit", content: "Use Python for data tasks." }),
    ];
    expect(selectMemories("", notes, 12, 6000).map(({ id }) => id)).toEqual([
      "global-rule", "global-preference",
    ]);

    const relevant = record({ id: "scoped-rust", type: "lessons", content: "Rust compiler workflow." });
    expect(selectMemories("Rust", [...notes, relevant], 12, memoryContextBlock([relevant]).length)).toEqual([relevant]);
  });

  test("enforces item and serialized character budgets without splitting records", () => {
    const notes = Array.from({ length: 14 }, (_, i) => record({
      id: `mem-${String(i).padStart(2, "0")}`,
      content: `Rust note ${i} with a durable detail.`,
      provenance: "explicit",
      type: "rules",
    }));
    const selected = selectMemories("Rust note", notes, 2, 6000);
    expect(selected.map(({ id }) => id)).toEqual(["mem-00", "mem-01"]);
    expect(selectMemories("Rust", notes, 12, 0)).toEqual([]);

    const exactSize = memoryContextBlock([notes[0]!]).length;
    expect(selectMemories("Rust", notes, 12, exactSize)).toEqual([notes[0]]);
    expect(selectMemories("Rust", notes, 12, exactSize - 1)).toEqual([]);

    const bounded = selectMemories("Rust", notes, 12, 280);
    expect(bounded.length).toBeGreaterThan(0);
    expect(bounded.length).toBeLessThanOrEqual(12);
    expect(memoryContextBlock(bounded).length).toBeLessThanOrEqual(280);
    expect(selectMemories("Rust", notes, 99, 6000)).toHaveLength(12);
  });

  test("does not select inactive or nonmatching notes for an empty task", () => {
    const notes = [record({ id: "inactive", content: "Rust compiler", status: "superseded" })];
    expect(selectMemories("", notes, 12, 6000)).toEqual([]);
  });
});
