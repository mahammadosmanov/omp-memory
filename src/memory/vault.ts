import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseMemoryNote, serializeMemoryNote } from "./note-codec";
import type { MemoryRecord, VaultStore } from "./types";

export function createVaultStore(rootDir: string): VaultStore {
  const root = resolve(rootDir);
  const inside = (path: string) => { const rel = relative(root, path); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); };
  async function checked(path: string): Promise<string> {
    if (!inside(path)) throw new Error("Memory path escapes vault");
    let current = root;
    const rel = relative(root, path);
    for (const part of rel.split(sep)) {
      if (!part) continue;
      current = resolve(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) {
          const target = await realpath(current);
          if (!inside(target)) throw new Error("Memory symlink escapes vault");
          current = target;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return path;
  }
  const observedHashes = new Map<string, string | null>();
  const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
  return {
    async readAll(): Promise<MemoryRecord[]> {
      const records: MemoryRecord[] = [];
      const hashes = new Map<string, string>();
      async function visit(dir: string): Promise<void> {
        await checked(dir);
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" && dir === root) return; throw error; }
        for (const entry of entries) {
          const path = resolve(dir, entry.name);
          await checked(path);
          if (entry.isSymbolicLink()) throw new Error(`Unsupported symlink in vault: ${entry.name}`);
          if (entry.isDirectory()) await visit(path);
          else if (entry.isFile() && entry.name.endsWith(".md")) {
            const bytes = await readFile(path);
            records.push(parseMemoryNote(bytes.toString("utf8")));
            hashes.set(path, hash(bytes));
          }
        }
      }
      await visit(root);
      for (const path of observedHashes.keys()) if (!hashes.has(path)) observedHashes.set(path, null);
      for (const [path, contentHash] of hashes) observedHashes.set(path, contentHash);
      return records;
    },
    async write(record: MemoryRecord, expectedContentHash?: string): Promise<"created" | "updated" | "conflict"> {
      const markdown = serializeMemoryNote(record);
      const path = await checked(resolve(root, record.type, `${record.id}.md`));
      await mkdir(dirname(path), { recursive: true });
      await checked(path);
      const observedHash = expectedContentHash ?? observedHashes.get(path);
      let old: Buffer | undefined;
      try { old = await readFile(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (old ? observedHash == null || hash(old) !== observedHash : observedHash !== undefined) return "conflict";
      const temp = resolve(dirname(path), `.${record.id}.${randomUUID()}.tmp`);
      await checked(temp);
      try {
        await writeFile(temp, markdown, { flag: "wx" });
        await checked(path);
        let current: Buffer | undefined;
        try { current = await readFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (old ? !current || !current.equals(old) : current !== undefined) return "conflict";
        await rename(temp, path);
        observedHashes.set(path, hash(markdown));
        return old ? "updated" : "created";
      } finally { await rm(temp, { force: true }); }
    },
  };
}
