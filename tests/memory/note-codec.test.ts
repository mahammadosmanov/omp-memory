import { describe, expect, test } from "bun:test";
import { parseMemoryNote, serializeMemoryNote } from "../../src/memory/note-codec";
import type { MemoryRecord } from "../../src/memory/types";

const record: MemoryRecord = {
  id: "mem_12345678-1234-4234-8234-123456789abc",
  type: "decisions",
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
  provenance: "explicit",
  confidence: 0.9,
  status: "active",
  content: "Keep Markdown canonical.",
};

describe("memory note codec", () => {
  test("round-trips stable IDs, categories, provenance, timestamps and optional metadata", () => {
    for (const type of ["preferences", "rules", "decisions", "corrections", "lessons", "projects"] as const) {
      const parsed = parseMemoryNote(serializeMemoryNote({ ...record, type }));
      expect(parsed).toEqual({ ...record, type });
      expect(serializeMemoryNote(parsed)).toBe(serializeMemoryNote({ ...record, type }));
    }
    expect(parseMemoryNote(serializeMemoryNote({ ...record, provenance: "inferred", confidence: undefined, status: undefined }))).toMatchObject({ provenance: "inferred" });
  });

  test("fails closed for malformed YAML, required fields, invalid enums and unknown fields", () => {
    const invalid = [
      "---\nid: [\n---\ntext",
      "---\ntype: rules\n---\ntext",
      `---\nid: ${record.id}\ntype: bogus\ncreatedAt: ${record.createdAt}\nupdatedAt: ${record.updatedAt}\nprovenance: explicit\n---\ntext`,
      `---\nid: ${record.id}\ntype: rules\ncreatedAt: ${record.createdAt}\nupdatedAt: ${record.updatedAt}\nprovenance: explicit\ncontent: text\nextra: nope\n---\ntext`,
    ];
    for (const note of invalid) expect(() => parseMemoryNote(note)).toThrow();
  });
});
