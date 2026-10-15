import { describe, expect, it } from "bun:test";
import type { CaptureResult } from "../../src/memory/capture";
import type { ExtensionContext } from "../../src/omp/extension";
import { notifyMemoryResult } from "../../src/omp/notifications";

function context(hasUI = true) {
  const notices: Array<{ message: string; type?: string }> = [];
  const ctx: ExtensionContext = {
    hasUI,
    ui: { notify: (message, type) => notices.push({ message, type }) },
  };
  return { ctx, notices };
}

describe("notifyMemoryResult", () => {
  it("distinguishes each persistence outcome without exposing memory content", () => {
    const statuses: CaptureResult[] = [
      { status: "created", id: "mem_note-one", type: "rules", content: "private memory body" } as CaptureResult,
      { status: "updated", id: "mem_note-two", type: "lessons" },
      { status: "conflict", id: "mem_note-three", type: "decisions", reason: "explicit-memory-conflict" },
      { status: "failed", id: "mem_note-four", type: "projects", reason: "vault-write-failed" },
    ];
    const { ctx, notices } = context();

    for (const result of statuses) notifyMemoryResult(ctx, result);

    expect(notices).toHaveLength(4);
    expect(notices.map(({ message }) => message)).toEqual([
      "OMP memory saved: rules/mem_note-one.",
      "OMP memory updated: lessons/mem_note-two.",
      "OMP memory conflict decisions/mem_note-three: nothing was overwritten. Review the vault note.",
      "OMP memory was not saved projects/mem_note-four. Check the configured vault and file permissions.",
    ]);
    expect(JSON.stringify(notices)).not.toContain("private memory body");
    expect(notices[3]?.type).toBe("error");
  });

  it("does nothing when OMP has no UI", () => {
    const { ctx, notices } = context(false);
    notifyMemoryResult(ctx, { status: "created", id: "mem_note", type: "rules" });
    expect(notices).toEqual([]);
  });
});
