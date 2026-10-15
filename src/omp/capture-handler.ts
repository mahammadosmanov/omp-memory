import { parseMemoryOperations, persistMemoryOperations, type CaptureResult } from "../memory/capture";
import type { VaultStore } from "../memory/types";
import type { AssistantMessageRewriteEvent } from "./extension";

/** The verified OMP 18.10.3 assistant_message post-response event. */
export type VerifiedCompletedTurn = AssistantMessageRewriteEvent;

function failed(reason: string): CaptureResult[] {
  return [{ status: "failed", reason }];
}

function completionText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const chunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) return undefined;
    const item = block as Record<string, unknown>;
    if (item.type !== "text" || typeof item.text !== "string" || Object.keys(item).some((key) => key !== "type" && key !== "text")) return undefined;
    chunks.push(item.text);
  }
  return chunks.join("\n");
}

type CandidateSection = { status: "found"; text: string } | { status: "absent" } | { status: "ambiguous" };

function candidateSection(text: string): CandidateSection {
  const lines: { start: number; end: number; content: string }[] = [];
  for (let start = 0; start < text.length;) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline + 1;
    lines.push({ start, end, content: text.slice(start, newline < 0 ? end : newline).replace(/\r$/, "") });
    start = end;
  }
  const headings: number[] = [];
  let openFence: { marker: "`" | "~"; length: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.content;
    if (openFence) {
      const closing = new RegExp(`^ {0,3}${openFence.marker === "`" ? "`" : "~"}{${openFence.length},}[ \\t]*$`);
      if (closing.test(line)) openFence = undefined;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening) {
      const marker = opening[1]![0] as "`" | "~";
      openFence = { marker, length: opening[1]!.length };
      continue;
    }
    if (/^#{1,2} .+$/.test(line)) headings.push(i);
  }

  const candidates = headings.filter((index) => /^## Memory candidate[ \t]*$/.test(lines[index]!.content));
  if (candidates.length === 0) return { status: "absent" };
  if (candidates.length !== 1) return { status: "ambiguous" };
  const startIndex = candidates[0]!;
  const nextHeading = headings.find((index) => index > startIndex);
  const end = nextHeading === undefined ? text.length : lines[nextHeading]!.start;
  return { status: "found", text: text.slice(lines[startIndex]!.start, end).trimEnd() };
}

/** Read and persist only the visible candidate from OMP's finalized response. */
export async function handleCompletedTurn(event: VerifiedCompletedTurn, store: VaultStore): Promise<CaptureResult[]> {
  const text = completionText(event?.message?.content);
  if (text === undefined) return failed("unsupported-completion-payload");
  const section = candidateSection(text);
  if (section.status === "absent") return [];
  if (section.status === "ambiguous") return failed("candidate-ambiguous");
  let operations;
  try {
    operations = parseMemoryOperations(section.text);
  } catch {
    return failed("candidate-invalid");
  }
  if (operations.length === 0) return [];
  return persistMemoryOperations(operations, store);
}
