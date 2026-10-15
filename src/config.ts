import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, open, readFile, realpath, rename, rm, mkdir, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, parse, resolve } from "node:path";

export interface MemorySettings {
  vaultPath: string | null;
  captureEnabled: boolean;
  retrievalEnabled: boolean;
  paused: boolean;
}

export const DEFAULT_MEMORY_SETTINGS: Readonly<MemorySettings> = Object.freeze({
  vaultPath: null,
  captureEnabled: false,
  retrievalEnabled: false,
  paused: false,
});

const SETTINGS_FIELDS = ["captureEnabled", "paused", "retrievalEnabled", "vaultPath"] as const;

export class MemorySettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemorySettingsError";
  }
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return value;
}

export function getMemorySettingsPath(override = process.env.OMP_MEMORY_SETTINGS_PATH): string {
  const path = expandHome(override ?? resolve(homedir(), ".omp", "agent", "omp-memory.json"));
  if (!isAbsolute(path)) throw new MemorySettingsError("Settings path must be absolute.");
  return resolve(path);
}

/** Validate only the chosen directory metadata; never enumerate its contents here. */
export async function validateVaultPath(path: string): Promise<string> {
  if (typeof path !== "string" || !path.trim()) throw new MemorySettingsError("Choose a non-empty vault path.");
  const expanded = expandHome(path.trim());
  if (!isAbsolute(expanded)) throw new MemorySettingsError("Vault path must be absolute (or start with ~/).");

  let canonical: string;
  try {
    canonical = await realpath(resolve(expanded));
    const info = await stat(canonical);
    if (!info.isDirectory()) throw new Error("not a directory");
    await access(canonical, constants.R_OK | constants.W_OK);
  } catch {
    throw new MemorySettingsError("Vault path must be an existing, readable, writable directory.");
  }

  const home = await realpath(homedir()).catch(() => resolve(homedir()));
  if (canonical === parse(canonical).root || canonical === home) {
    throw new MemorySettingsError("Choose a dedicated vault directory, not a filesystem root or your home directory.");
  }
  return canonical;
}

function decodeSettings(text: string): MemorySettings {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new MemorySettingsError("Settings JSON is malformed. Use `/omp-memory reset --confirm` to restore defaults.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemorySettingsError("Settings must be a JSON object. Use `/omp-memory reset --confirm` to restore defaults.");
  }
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).sort().join(",") !== SETTINGS_FIELDS.join(",")
    || !(settings.vaultPath === null || typeof settings.vaultPath === "string")
    || typeof settings.captureEnabled !== "boolean"
    || typeof settings.retrievalEnabled !== "boolean"
    || typeof settings.paused !== "boolean"
    || (settings.vaultPath === null && (settings.captureEnabled || settings.retrievalEnabled))) {
    throw new MemorySettingsError("Settings schema is invalid. Use `/omp-memory reset --confirm` to restore defaults.");
  }
  return settings as unknown as MemorySettings;
}

export async function readMemorySettings(path?: string): Promise<MemorySettings> {
  const settingsPath = getMemorySettingsPath(path);
  try {
    return decodeSettings(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_MEMORY_SETTINGS };
    throw error;
  }
}

export async function writeMemorySettings(settings: MemorySettings, path?: string): Promise<void> {
  const settingsPath = getMemorySettingsPath(path);
  const validatedSettings: MemorySettings = {
    ...settings,
    vaultPath: settings.vaultPath === null ? null : await validateVaultPath(settings.vaultPath),
  };
  // Reuse the exact on-disk schema validator before replacing an existing file.
  const serialized = `${JSON.stringify(validatedSettings, null, 2)}\n`;
  decodeSettings(serialized);
  const temp = resolve(dirname(settingsPath), `.omp-memory.${randomUUID()}.tmp`);
  await mkdir(dirname(settingsPath), { recursive: true });
  let handle: FileHandle | undefined;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, settingsPath);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

/** Load an existing configuration and canonicalize its selected vault before activation. */
export async function loadValidatedMemorySettings(path?: string): Promise<MemorySettings> {
  const settings = await readMemorySettings(path);
  if (settings.vaultPath !== null) settings.vaultPath = await validateVaultPath(settings.vaultPath);
  return settings;
}
