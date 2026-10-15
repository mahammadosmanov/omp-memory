export type {
  AgentMessage,
  AssistantMessage,
  AssistantMessageRewriteEvent,
  BeforeAgentStartEvent,
  ContextEvent,
  ExtensionContext,
  ExtensionUIContext,
  VerifiedOmpExtensionApi,
} from "./omp/extension.js";

export { default, registerMemoryExtension } from "./omp/extension.js";
export type { MemorySettings } from "./config.js";
