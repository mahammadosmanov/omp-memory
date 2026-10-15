import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MEMORY_SETTINGS,
  MemorySettingsError,
  loadValidatedMemorySettings,
  readMemorySettings,
  validateVaultPath,
  writeMemorySettings,
} from "../src/config";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "omp-memory-config-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("memory settings", () => {
  it("defaults missing configuration to disabled features", async () => {
    const settingsPath = join(await temporaryDirectory(), "settings.json");
    expect(await readMemorySettings(settingsPath)).toEqual(DEFAULT_MEMORY_SETTINGS);
  });

  it("persists an explicitly selected vault and only its enabled features", async () => {
    const root = await temporaryDirectory();
    const vault = join(root, "selected-vault");
    const settingsPath = join(root, "settings.json");
    await mkdir(vault);
    const selectedPath = await validateVaultPath(vault);
    await writeMemorySettings({
      vaultPath: selectedPath,
      captureEnabled: true,
      retrievalEnabled: false,
      paused: false,
    }, settingsPath);

    expect(await loadValidatedMemorySettings(settingsPath)).toEqual({
      vaultPath: selectedPath,
      captureEnabled: true,
      retrievalEnabled: false,
      paused: false,
    });
  });

  it("rejects relative paths and filesystem roots", async () => {
    await expect(validateVaultPath("relative-vault")).rejects.toBeInstanceOf(MemorySettingsError);
    await expect(validateVaultPath("/")).rejects.toBeInstanceOf(MemorySettingsError);
  });

  it("fails closed on malformed JSON and permits an explicit reset", async () => {
    const settingsPath = join(await temporaryDirectory(), "settings.json");
    await writeFile(settingsPath, "{not-json", "utf8");

    await expect(loadValidatedMemorySettings(settingsPath)).rejects.toBeInstanceOf(MemorySettingsError);
    await writeMemorySettings({ ...DEFAULT_MEMORY_SETTINGS }, settingsPath);
    expect(await readMemorySettings(settingsPath)).toEqual(DEFAULT_MEMORY_SETTINGS);
  });

  it("rejects unknown or incomplete settings fields", async () => {
    const settingsPath = join(await temporaryDirectory(), "settings.json");
    await writeFile(settingsPath, JSON.stringify({ ...DEFAULT_MEMORY_SETTINGS, enabled: true }), "utf8");

    await expect(readMemorySettings(settingsPath)).rejects.toBeInstanceOf(MemorySettingsError);
  });
});
