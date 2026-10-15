import { memoryContextBlock, selectMemories } from "../memory/retrieval";
import type { VaultStore } from "../memory/types";
import type { AgentMessage, ContextEvent } from "./extension";

export type VerifiedBeforeModelEvent = ContextEvent;

function userText(message: AgentMessage): string {
  if (typeof message.role !== "string" || message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.flatMap((part) => {
    if (typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string") {
      return [part.text];
    }
    return [];
  }).join("\n");
}

function latestUserText(messages: AgentMessage[]): string {
  let latest = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      latest = i;
      break;
    }
  }
  if (latest < 0) return "";
  let first = latest;
  while (first > 0 && messages[first - 1]?.role === "user") first--;
  return messages.slice(first, latest + 1).map(userText).join("\n");
}

export async function injectMemoryContext(
  event: VerifiedBeforeModelEvent,
  store: VaultStore,
  onUnavailable?: () => void,
): Promise<VerifiedBeforeModelEvent> {
  try {
    const records = await store.readAll();
    const selected = selectMemories(latestUserText(event.messages), records);
    if (selected.length === 0) return event;
    const memoryMessage: AgentMessage = { role: "user", content: memoryContextBlock(selected) };
    return { ...event, messages: [...event.messages, memoryMessage] };
  } catch {
    try {
      onUnavailable?.();
    } catch {
      // The failure notice must not interfere with the original model request.
    }
    return event;
  }
}
