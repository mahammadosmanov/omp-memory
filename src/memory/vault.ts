import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isMemoryNoteFilename, parseMemoryNote, serializeMemoryNote } from "./note-codec";
import { MEMORY_TYPES, type MemoryRecord, type VaultStore } from "./types";

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
  async function ensureCategoryDirectory(type: (typeof MEMORY_TYPES)[number]): Promise<string> {
    const dir = resolve(root, type);
    await checked(dir);
    try { await mkdir(dir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const info = await lstat(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsupported memory category directory: ${type}`);
    return dir;
  }
  return {
    async readAll(): Promise<MemoryRecord[]> {
      const records: MemoryRecord[] = [];
      const hashes = new Map<string, string>();
      for (const type of MEMORY_TYPES) {
        const dir = resolve(root, type);
        let entries;
        try {
          await checked(dir);
          if ((await lstat(dir)).isSymbolicLink()) throw new Error(`Unsupported symlink in vault: ${type}`);
          entries = await readdir(dir, { withFileTypes: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        for (const entry of entries) {
          if (!isMemoryNoteFilename(entry.name)) continue;
          const path = resolve(dir, entry.name);
          await checked(path);
          if (entry.isSymbolicLink() || !entry.isFile()) {
            throw new Error(`Unsupported memory note entry: ${entry.name}`);
          }
          const bytes = await readFile(path);
          records.push(parseMemoryNote(bytes.toString("utf8")));
          hashes.set(path, hash(bytes));
        }
      }
      for (const path of observedHashes.keys()) if (!hashes.has(path)) observedHashes.set(path, null);
      for (const [path, contentHash] of hashes) observedHashes.set(path, contentHash);
      return records;
    },
    async write(record: MemoryRecord, expectedContentHash?: string): Promise<"created" | "updated" | "conflict"> {
      const markdown = serializeMemoryNote(record);
      const dir = await ensureCategoryDirectory(record.type);
      const path = await checked(resolve(dir, `${record.id}.md`));
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
