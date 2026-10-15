import { loadValidatedMemorySettings, readMemorySettings, validateVaultPath, writeMemorySettings } from "../config";
import type { MemorySettings } from "../config";
import { createVaultStore } from "../memory/vault";
import { handleCompletedTurn } from "./capture-handler";
import { injectMemoryContext } from "./context-handler";
import { notifyMemoryResult } from "./notifications";

export interface AgentMessage {
  [key: string]: unknown;
}

export interface ContextEvent {
  type: "context";
  messages: AgentMessage[];
}

export interface BeforeAgentStartEvent {
  type: "before_agent_start";
  prompt: string;
  images?: unknown[];
  systemPrompt: string[];
}

export interface AssistantMessage {
  [key: string]: unknown;
  content: unknown;
}

export interface AssistantMessageRewriteEvent {
  type: "assistant_message";
  message: AssistantMessage;
}

export interface ExtensionUIContext {
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface ExtensionContext {
  hasUI: boolean;
  ui: ExtensionUIContext;
}

type ExtensionHandler<Event, Result> =
  (event: Event, ctx: ExtensionContext) => Result | void | Promise<Result | void>;

export interface VerifiedOmpExtensionApi {
  on(event: "context", handler: ExtensionHandler<ContextEvent, { messages?: AgentMessage[] }>): void;
  on(event: "before_agent_start", handler: ExtensionHandler<BeforeAgentStartEvent, {
    message?: unknown;
    systemPrompt?: string[];
  }>): void;
  on(event: "assistant_message", handler: ExtensionHandler<AssistantMessageRewriteEvent, {
    content?: AssistantMessage["content"];
  }>): void;
  registerCommand(name: string, command: {
    description?: string;
    handler(args: string, ctx: ExtensionContext): void | Promise<void>;
  }): void;
}

export const CAPTURE_INSTRUCTION = [
  "When this conversation establishes one concise, durable preference, rule, decision, correction, lesson, or project fact, append exactly one standalone visible `## Memory candidate` section to your ordinary final response. Never include a full conversation or transcript.",
  "If there is no durable memory, omit the entire section.",
  "The section must contain exactly one `json` fence whose entire contents are a JSON array of valid `upsert` operations accepted by the memory candidate format. Each record must use a valid `mem_<UUIDv4>` ID, one allowed type (preferences, rules, decisions, corrections, lessons, projects), valid UTC ISO-8601 createdAt/updatedAt timestamps, explicit or inferred provenance, and one concise durable fact as content.",
  "Use this valid example shape, replacing the ID, timestamps, category, provenance, and content with valid values:",
  "```json",
  '[{"operation":"upsert","record":{"id":"mem_550e8400-e29b-41d4-a716-446655440000","type":"preferences","createdAt":"2026-10-14T10:00:00.000Z","updatedAt":"2026-10-14T10:00:00.000Z","provenance":"explicit","content":"One concise durable fact."}}]',
  "```",
].join("\n");

let runtimeSettings: MemorySettings | undefined;

function commandTokens(args: string): string[] {
  const trimmed = args.trim();
  if (!trimmed) return [];
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace < 0) return [trimmed];
  return [trimmed.slice(0, firstSpace), trimmed.slice(firstSpace).trim()];
}

function show(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(message, type);
}

async function manageMemory(args: string, ctx: ExtensionContext): Promise<void> {
  const [subcommand, argument] = commandTokens(args);
  const settingsPath = process.env.OMP_MEMORY_SETTINGS_PATH;
  try {
    if (!subcommand || subcommand === "status") {
      const settings = await loadValidatedMemorySettings(settingsPath);
      show(ctx, `OMP memory: vault ${settings.vaultPath ? "configured" : "not configured"}; capture ${settings.captureEnabled ? "on" : "off"}; retrieval ${settings.retrievalEnabled ? "on" : "off"}; ${settings.paused ? "paused" : "active"}.`);
      return;
    }
    if (subcommand === "reset") {
      if (argument !== "--confirm") {
        show(ctx, "Reset is explicit and affects settings only. Run `/omp-memory reset --confirm` to restore opt-in defaults.", "warning");
        return;
      }
      const defaults: MemorySettings = {
        vaultPath: null,
        captureEnabled: false,
        retrievalEnabled: false,
        paused: false,
      };
      await writeMemorySettings(defaults, settingsPath);
      runtimeSettings = defaults;
      show(ctx, "OMP memory settings reset; capture and retrieval are off.");
      return;
    }
    if (subcommand === "setup") {
      if (!argument) {
        show(ctx, "Usage: `/omp-memory setup /absolute/path/to/vault` (or `~/path/to/vault`).", "warning");
        return;
      }
      const current = await readMemorySettings(settingsPath);
      const vaultPath = await validateVaultPath(argument.replace(/^(['\"])(.*)\1$/, "$2"));
      const next = { ...current, vaultPath };
      await writeMemorySettings(next, settingsPath);
      runtimeSettings = next;
      show(ctx, "OMP memory vault path changed. Existing handlers are paused until OMP restarts and reopens the selected vault.");
      return;
    }
    if (subcommand === "capture" || subcommand === "retrieval") {
      if (argument !== "on" && argument !== "off") {
        show(ctx, `Usage: \`/omp-memory ${subcommand} on|off\`.`, "warning");
        return;
      }
      const current = await readMemorySettings(settingsPath);
      if (argument === "on" && current.vaultPath === null) {
        show(ctx, "Configure a vault first with `/omp-memory setup PATH`.", "warning");
        return;
      }
      const vaultPath = argument === "on" ? await validateVaultPath(current.vaultPath!) : current.vaultPath;
      const next = subcommand === "capture"
        ? { ...current, vaultPath, captureEnabled: argument === "on" }
        : { ...current, vaultPath, retrievalEnabled: argument === "on" };
      await writeMemorySettings(next, settingsPath);
      runtimeSettings = next;
      show(ctx, `OMP memory ${subcommand} ${argument}${argument === "on" ? "; restart OMP to activate" : "; disabled immediately"}.`);
      return;
    }
    if (subcommand === "pause" || subcommand === "resume") {
      const current = await readMemorySettings(settingsPath);
      const next = { ...current, paused: subcommand === "pause" };
      await writeMemorySettings(next, settingsPath);
      runtimeSettings = next;
      show(ctx, `OMP memory ${subcommand === "pause" ? "paused" : "resumed"}${subcommand === "pause" ? " immediately" : "; restart OMP if handlers were inactive or the vault path changed"}.`);
      return;
    }
    show(ctx, "Usage: `/omp-memory status|setup PATH|capture on|off|retrieval on|off|pause|resume|reset --confirm`.", "warning");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Configuration could not be read or saved.";
    show(ctx, `OMP memory configuration error: ${message}`, "error");
  }
}

/** Compose management and enabled model handlers from validated startup settings. */
export async function registerMemoryExtension(api: VerifiedOmpExtensionApi): Promise<void> {
  api.registerCommand("omp-memory", {
    description: "Configure local Obsidian memory capture and retrieval",
    handler: manageMemory,
  });

  let settings: MemorySettings;
  try {
    settings = await loadValidatedMemorySettings();
  } catch {
    // Invalid configuration fails closed; the always-available command reports and repairs it.
    return;
  }
  runtimeSettings = settings;
  if (!settings.vaultPath || settings.paused) return;
  const storePath = settings.vaultPath;
  const store = createVaultStore(storePath);

  if (settings.retrievalEnabled) {
    api.on("context", (event, ctx) => {
      if (runtimeSettings?.paused || !runtimeSettings?.retrievalEnabled || runtimeSettings.vaultPath !== storePath) return;
      return injectMemoryContext(event, store, () => {
        show(ctx, "OMP memory context was unavailable; continuing without saved memories.", "warning");
      });
    });
  }
  if (settings.captureEnabled) {
    api.on("before_agent_start", (event) => {
      if (runtimeSettings?.paused || !runtimeSettings?.captureEnabled || runtimeSettings.vaultPath !== storePath) return;
      return { systemPrompt: [...event.systemPrompt, CAPTURE_INSTRUCTION] };
    });
    api.on("assistant_message", async (event, ctx) => {
      if (runtimeSettings?.paused || !runtimeSettings?.captureEnabled || runtimeSettings.vaultPath !== storePath) return;
      const results = await handleCompletedTurn(event, store);
      for (const result of results) notifyMemoryResult(ctx, result);
    });
  }
}

export default async function ompMemoryExtension(api: VerifiedOmpExtensionApi): Promise<void> {
  await registerMemoryExtension(api);
}

