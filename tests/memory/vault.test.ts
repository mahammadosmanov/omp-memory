import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultStore } from "../../src/memory/vault";
import type { MemoryRecord } from "../../src/memory/types";

const record: MemoryRecord = { id: "mem_12345678-1234-4234-8234-123456789abc", type: "rules", createdAt: "2026-10-14T10:00:00.000Z", updatedAt: "2026-10-14T10:00:00.000Z", provenance: "explicit", content: "Keep it concise." };
const roots: string[] = [];
async function vault() { const root = await mkdtemp(join(tmpdir(), "omp-memory-")); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("vault store", () => {
  test("writes atomically and detects stale edits without changing external bytes", async () => {
    const root = await vault(); const store = createVaultStore(root);
    expect(await store.write(record)).toBe("created");
    const initial = await readFile(join(root, "rules", `${record.id}.md`), "utf8");
    expect(await store.readAll()).toHaveLength(1);
    const external = `${initial}\nexternal bytes\n`;
    await writeFile(join(root, "rules", `${record.id}.md`), external);
    expect(await store.write({ ...record, content: "new" })).toBe("conflict");
    expect(await readFile(join(root, "rules", `${record.id}.md`), "utf8")).toBe(external);
  });

  test("updates a note after observing it and rejects a later external edit", async () => {
    const root = await vault(); const store = createVaultStore(root);
    expect(await store.write(record)).toBe("created");
    await store.readAll();
    expect(await store.write({ ...record, content: "Updated safely." })).toBe("updated");
    await store.readAll();
    const path = join(root, "rules", `${record.id}.md`);
    const external = `${await readFile(path, "utf8")}external bytes\n`;
    await writeFile(path, external);
    expect(await store.write({ ...record, content: "Must not replace external edit." })).toBe("conflict");
    expect(await readFile(path, "utf8")).toBe(external);
  });

  test("rejects path traversal and out-of-vault symlink targets", async () => {
    const root = await vault(); const outside = await mkdtemp(join(tmpdir(), "omp-outside-")); roots.push(outside);
    const store = createVaultStore(root);
    await expect(store.write({ ...record, id: "../../outside" })).rejects.toThrow();
    await mkdir(join(root, "rules")); await symlink(outside, join(root, "rules", record.id + ".md"));
    await expect(store.write(record)).rejects.toThrow();
  });

  test("does not write through an in-vault category symlink", async () => {
    const root = await realpath(await vault());
    const unrelated = join(root, "Journal");
    await mkdir(unrelated);
    await symlink(unrelated, join(root, "rules"));

    const store = createVaultStore(root);
    await expect(store.write(record)).rejects.toThrow();
    await expect(readFile(join(unrelated, `${record.id}.md`), "utf8")).rejects.toThrow();
  });

  test("ignores ordinary Obsidian notes while reading memories from the vault root", async () => {
    const root = await vault();
    const rootContent = "# Vault home\nPersonal notes stay unchanged.\n";
    const categoryContent = "# Reading list\nThis is not an OMP memory.\n";
    const unrelatedContent = "# Journal entry\nThis folder is outside memory categories.\n";
    await writeFile(join(root, "Welcome.md"), rootContent);
    await mkdir(join(root, "lessons"));
    await writeFile(join(root, "lessons", "daily-note.md"), categoryContent);
    await mkdir(join(root, "Journal"));
    await writeFile(join(root, "Journal", "entry.md"), unrelatedContent);

    const store = createVaultStore(root);
    expect(await store.readAll()).toEqual([]);
    expect(await store.write(record)).toBe("created");
    expect(await store.readAll()).toEqual([record]);
    expect(await readFile(join(root, "Welcome.md"), "utf8")).toBe(rootContent);
    expect(await readFile(join(root, "lessons", "daily-note.md"), "utf8")).toBe(categoryContent);
    expect(await readFile(join(root, "Journal", "entry.md"), "utf8")).toBe(unrelatedContent);
    expect(await readFile(join(root, "rules", `${record.id}.md`), "utf8")).toContain(record.content);
  });

  test("surfaces malformed notes from readAll", async () => {
    const root = await vault(); await mkdir(join(root, "rules"));
    await writeFile(join(root, "rules", `${record.id}.md`), "---\nid: [\n---\ninvalid");
    await expect(createVaultStore(root).readAll()).rejects.toThrow();
  });
});
