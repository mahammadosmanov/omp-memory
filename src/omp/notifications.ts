import type { CaptureResult } from "../memory/capture";
import type { MemoryType } from "../memory/types";
import type { ExtensionContext } from "./extension";

function memoryLabel(result: { id?: string; type?: MemoryType }): string {
  if (result.type && result.id) return ` ${result.type}/${result.id}`;
  return result.type ? ` ${result.type}` : result.id ? ` ${result.id}` : "";
}

/** Report persistence outcomes through OMP's local UI, never through a provider. */
export function notifyMemoryResult(ctx: ExtensionContext, result: CaptureResult): void {
  if (!ctx.hasUI) return;

  const label = memoryLabel(result);
  switch (result.status) {
    case "created":
      ctx.ui.notify(`OMP memory saved:${label}.`, "info");
      break;
    case "updated":
      ctx.ui.notify(`OMP memory updated:${label}.`, "info");
      break;
    case "conflict":
      ctx.ui.notify(`OMP memory conflict${label}: nothing was overwritten. Review the vault note.`, "warning");
      break;
    case "failed":
      ctx.ui.notify(`OMP memory was not saved${label}. Check the configured vault and file permissions.`, "error");
      break;
  }
}
