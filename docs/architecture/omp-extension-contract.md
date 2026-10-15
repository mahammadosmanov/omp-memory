# OMP extension contract for automatic Markdown memory

**Verified runtime:** OMP 18.10.3, installed as `@oh-my-pi/pi-coding-agent@18.10.3` under Bun on this workstation. This is the minimum version verified by this contract; support for earlier versions is not established. The revised visible-candidate contract has been exercised with a synthetic local deterministic provider; no real provider/model reliability claim is made.

## Finding

**Feasible at the OMP API boundary for the user-approved visible-candidate design.** OMP exposes a same-turn path to provide capture instructions and observe the finalized assistant response, and `ctx.ui.notify` can emit a local notice. The user accepts a short, human-readable `Memory candidate` section in the ordinary response. Because `assistant_message` runs after streaming and cannot retract `message_update` text, the extension must leave that section visible; do not attempt a hidden structured channel or post-stream concealment. The smoke proves the event exposes a fixed synthetic candidate heading before persistence and supports a local notice. It does not test a parser, Markdown write, or arbitrary model compliance.

The controller's synthetic provider returned a fixed visible `## Memory candidate` heading. In print mode the probe observed `context`, `assistant_message`, and `turn_end`, detected only the fixed marker as a boolean, logged one provider request, and emitted the ordinary response with the candidate still visible. A separate TUI run displayed the same candidate and local completion notice. This verifies same-turn access to the synthetic candidate and local notification in the exercised OMP modes; it does not test memory parsing, filesystem writes, arbitrary model compliance, or hidden delivery.


## Exact extension interfaces

The installed public declaration is `dist/types/extensibility/extensions/types.d.ts` in the OMP 18.10.3 package. The matching source contract is `packages/coding-agent/src/extensibility/extensions/types.ts` in the public repository.

- `ExtensionAPI.on(event, handler)` registers a typed event handler. `ExtensionHandler<E, R> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void`.
- **`context` (pre-model context transform):** `ContextEvent = { type: "context"; messages: AgentMessage[] }`. `messages` is documented as a deep copy safe to modify. Return `ContextEventResult = { messages?: AgentMessage[] }` to replace the messages sent to the model. Original session messages/history are not mutated by this transform; replacements chain through handlers. It is called for model context assembly, not merely once at user-submission time, so keep the transform deterministic/idempotent and avoid unintended repeated injection.
- **`before_agent_start` (turn preparation):** `BeforeAgentStartEvent = { type: "before_agent_start"; prompt: string; images?: ImageContent[]; systemPrompt: string[] }`. `prompt` is already-transformed user text; queued user-containing batches join user messages with two newlines and exclude hidden agent-attributed companions; images are normalized. Return `BeforeAgentStartEventResult = { message?: CustomMessagePayload; systemPrompt?: string[] }`. A returned custom message is appended once after the original batch, and system-prompt overrides chain. This can deliver the capture protocol during the ordinary turn without adding a later prompt. This event may run again during bounded preparation retries and for dequeued user-containing batches; external effects in its handler cannot be rolled back.
- **`assistant_message` (finalized assistant response, read-before-persistence):** `AssistantMessageRewriteEvent = { type: "assistant_message"; message: AssistantMessage }`; return `{ content?: AssistantMessage["content"] }` only when intentionally rewriting. It fires once per finalized assistant message after the provider stream settles and before agent context, persistence, `message_end`, or tool dispatch. The message is detached; replacements chain. Text already streamed through `message_update` is not retracted, and no supported event permits rewriting each streamed update. The approved design parses a visibly labeled candidate section and does not rewrite or hide it.
- **`turn_end` (turn completion observation):** `TurnEndEvent = { type: "turn_end"; turnIndex: number; message: AgentMessage; toolResults: ToolResultMessage[] }`. This is notification-only; the approved capture handler reads the finalized response in `assistant_message` before persistence. Turns involving tools can entail multiple provider requests; “no extra extraction invocation” does not mean every whole agent turn always has exactly one provider request.
- **`before_provider_request`:** event `{ type: "before_provider_request"; payload: unknown }`, handler may return a replacement payload itself; handlers chain. This event is useful for counting/measuring requests, but transport support depends on the provider adapter invoking `onPayload` (the upstream hook docs explicitly note `devin-agent` does not). The capture design should not depend on this event for correctness.

The installed declarations for `context`, `before_agent_start`, `assistant_message`, and `turn_end` are in `dist/types/extensibility/extensions/types.d.ts` and `dist/types/extensibility/shared-events.d.ts`; those are shipped declarations, not inferred from CLI switches.

## UI behavior

`ExtensionContext` includes `hasUI: boolean`, `mode: "tui" | "rpc" | "json" | "print"`, and `ui: ExtensionUIContext`. `ctx.ui.notify(message, type?: "info" | "warning" | "error"): void` is the local notification interface. Check `ctx.hasUI` before notifying; with no UI, the host supplies a no-op UI context. This is a local UI operation and has no model-call API. Interactive terminal capabilities beyond notify are mode-dependent; this product should only rely on notify and make headless behavior non-fatal.

## Loading and version floor

The installed version verified here is `omp/18.10.3`. Contract minimum is **18.10.3**, the first and only version evidenced by local installed declarations/runtime in this assignment; no claim is made that earlier releases lack the APIs, only that they have not been verified here.

Supported setup for a loose extension file:

- Explicit CLI: `omp --extension /absolute/path/to/extension.ts` (alias `-e`). The documented extension-loading surface also accepts configured `extensions:` paths and ambient `.omp/extensions/` directories.
- Native project discovery: put `.ts`/`.js` extension modules under `<cwd>/.omp/extensions/`; user extensions are under the active agent directory's `extensions/` (normally `~/.omp/agent/extensions/`).
- Settings example: `extensions: ["/absolute/path/to/extension.ts"]` in the applicable OMP configuration. Explicit CLI paths are preferable for the isolated contract probe.

The loader imports TS/JS modules with Bun. Extensions run in-process; this is not a sandbox. They must avoid loading or persisting conversation bodies except where required for the feature's validated capture operation.

## Provider portability boundary

The event surface is supplied by OMP's extension runner, not a provider-specific extension API. `before_agent_start`/`context` and `assistant_message`/`turn_end` operate at the OMP conversation boundary, so the capture flow can use ordinary text instructions and ordinary text output across providers without depending on a vendor JSON-schema mode. The relevant portability limitation is model compliance and response shape, not a provider API primitive. Provider adapters can differ in tools, streaming, content blocks, and retry/request counts; extraction must accept only validated supported text output and fail closed for absent/malformed operations. Do not count every provider request using `before_provider_request` as a cross-provider invariant; its notification depends on adapter `onPayload` support. This contract does not establish operation across every registered provider or third-party adapter.

## Built-in memory / `ctx.memory` comparison

Installed `dist/types/memory-backend/types.d.ts` declares mutually exclusive backend IDs `off | local | hindsight | mnemopi | sharpshooter`; `ExtensionContext.memory?: MemoryRuntimeContext` is optional and only exposes:

```ts
status(): Promise<MemoryBackendStatus>
search(query: string, options?: MemoryBackendSearchOptions): Promise<MemoryBackendSearchResult>
save(input: string | MemoryBackendSaveInput): Promise<MemoryBackendSaveResult>
```

`MemoryBackendSaveInput` is `{ content: string; context?: string; source?: string; importance?: number }`. This API does not accept a vault path, category/frontmatter contract, safe note-path policy, or a Markdown-file writer. It is backend-generic; `save` has backend-specific behavior and cannot be assumed to be local or Markdown-only. `hindsight` is remote. `mnemopi` is local SQLite. `local` generates project-scoped summaries/lessons from persisted sessions through extraction/consolidation work that can make separate model calls; its persisted memory artifacts are not the user's configured Obsidian vault as canonical Markdown. `sharpshooter` is a friction-gated project decision backend, not the approved automatic vault contract.

The built-in local `learn` tool is an explicit lesson-capture operation (when `autolearn.enabled` is on); local lessons are deduplicated, secret-redacted, stored in `learned.md`, capped, and injected from a subsequent session. It is not automatic extraction of each conversation turn into user-selected Obsidian Markdown. The built-in local summary pipeline scans eligible persisted sessions and uses a background extraction/consolidation model pipeline, contrary to the feature's no-extra-extraction-call and immediate automatic capture requirements. Hindsight has remote retention/recall behavior; Mnemopi is SQLite-backed; neither gives the Markdown-vault source-of-truth guarantee. Consequently, `ctx.memory` is not a suitable implementation backend for this feature. The extension can use OMP lifecycle events and write validated Markdown itself; avoid also enabling a built-in memory backend in a way that duplicates or unexpectedly retains the same conversation data.

## Controller smoke evidence and gate

The controller exercised the updated probe with a local deterministic HTTP model and isolated HOME/profile. Headless command: `omp --extension /tmp/omp-memory-task1-probe.ts --no-session -p --model memory-probe/memory-probe-model ...`. The event log records `context`, `before_provider_request`, `assistant_message`, and `turn_end`; one user-role context message, one assistant completion with one text block, `sawSyntheticCandidateHeading: true`, and `requestCount: 1`. The output visibly contained the candidate section. A separate interactive TUI turn visibly showed the candidate and the local completion notice; its extension log reported two requests, and OMP subsequently made its own default title-generator request. These extra TUI requests are not evidence of an extension memory-extraction call. All provider traffic went to the local deterministic mock; no user provider or vault was touched.

This verifies same-turn access to a fixed synthetic visible candidate, the public `assistant_message` event, one headless request, and local TUI notification. It does not verify schema parsing, persistence, real-model compliance, or behavior on every provider. No post-stream rewrite is used by the approved design.

## Primary sources

- OMP extension authoring guide: <https://omp.sh/docs/extension-authoring> — TypeScript module contract, extension event API and `--extension` loading.
- OMP hooks guide: <https://omp.sh/docs/hooks> — hook event and context-transform behavior.
- OMP memory guide: <https://omp.sh/docs/memory> — built-in backends, local extraction/consolidation, `learn`, and configuration.
- Official OMP source: <https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts>, <https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/shared-events.ts>, and <https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/memory-backend/types.ts>.
