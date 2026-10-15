# omp-memory

`omp-memory` is an OMP extension that saves concise durable memories as ordinary Markdown in a vault you choose, then retrieves relevant notes for later OMP model calls. OMP **18.10.3** is the minimum version verified against the public extension API; compatibility with other versions is not established.

## Install

Clone or copy the complete repository to each computer and run `bun install` in its root to install the extension's runtime dependency. Then load its entrypoint directly with OMP:

```sh
omp --extension /absolute/path/to/omp-memory/src/index.ts
```

The `--extension` option also has the `-e` alias. To load it on each OMP start, add this absolute entrypoint path to the `extensions:` list in the active OMP `config.yml`. Keep the repository and its installed dependencies together; do not copy only `src/index.ts`. OMP runs extensions in-process, so only load code you trust. The extension is TypeScript and uses OMP's Bun runtime.

Run project checks with `bun run typecheck` and `bun test`.

## Configure

The management command is always available, including when memory is disabled:

```text
/omp-memory status
/omp-memory setup ~/Documents/Obsidian/MyVault
/omp-memory capture on
/omp-memory retrieval on
/omp-memory pause
/omp-memory resume
/omp-memory capture off
/omp-memory retrieval off
```

`setup` accepts an existing directory path, either absolute or beginning with `~/`; quote the argument if it contains spaces. It validates only the selected directory and does not search for vaults. Filesystem roots and your home directory are rejected; you may select the root of your Obsidian vault. Memory notes are grouped under the six category directories (`preferences/`, `rules/`, `decisions/`, `corrections/`, `lessons/`, `projects/`) and use reserved `mem_<uuid>.md` filenames. The extension reads only those named files in those directories; other Markdown notes and folders are left untouched. Missing category directories are created when a memory is saved. Setup does not enable any feature. Capture and retrieval are independently opt-in and become active after restarting OMP. Changing the vault path also requires a restart because registered handlers hold the selected vault store. Turning a feature off or pausing takes effect immediately when its handlers are active. Resuming takes effect immediately if handlers were active at startup and the vault path has not changed; otherwise restart OMP.

Settings are stored separately from the vault and repository at `~/.omp/agent/omp-memory.json`. Set `OMP_MEMORY_SETTINGS_PATH` to an absolute path (or a `~/...` path) to relocate settings for a profile. The settings JSON has exactly four fields: `vaultPath` (absolute path or `null`), `captureEnabled`, `retrievalEnabled`, and `paused`. Writes use a temporary file and atomic rename. Missing settings default to no vault and both features off. Invalid or malformed settings fail closed; they are not silently replaced. To explicitly restore opt-in defaults, run `/omp-memory reset --confirm`. Reset affects settings only, not vault notes.

## Behavior and privacy

When capture is enabled, OMP adds a capture instruction to ordinary model context and reads only the visible `Memory candidate` section in the finalized OMP assistant response. That candidate remains visible in the response. The same ordinary model invocation produces it; there is no separate extraction call. Only concise validated memory records are written—never a full conversation transcript. A local notice reports the actual created, updated, conflict, or failed filesystem result and includes the note category and ID when known, never the note body. Notifications use OMP's local UI and are a no-op in headless contexts.

The extension reads and writes memory notes only inside the vault directory you explicitly configure. Its extension-owned settings are stored separately in the OMP agent configuration directory described above. It does not search project files, shell history, or activity outside OMP. Within the selected vault it reads only reserved memory files in the six category directories; other Markdown notes and folders are not read or changed. Notes are editable Markdown with YAML frontmatter; keep the vault private and use your own Obsidian Sync or private Git workflow if you want synchronization. The public code repository is separate from the personal vault.

When retrieval is enabled, each model context may include only a compact relevant selection—up to 12 notes and 6,000 characters including delimiters and labels. This consumes model-context tokens; capture instructions and the visible candidate also use ordinary prompt/output tokens. If vault reading fails, OMP continues without injected memories and displays a local unavailable notice when a UI is present.

Memory text is user data, not executable instructions or policy. Review and edit notes in Obsidian. `/omp-memory status` reports whether a vault is configured and each feature's state without printing note content or the vault path.

For a concrete directory layout, `examples/vault/` is intentionally empty except for its tracked `.gitkeep`; all other files there are ignored. The selected vault remains ordinary Markdown and needs no database. Back up or synchronize it separately from this public repository, using your private Obsidian Sync vault or a private Git repository if desired; synchronization is your choice and is not provided by this extension.

## License

MIT; see `LICENSE`. The `private: true` package flag prevents npm publishing; GitHub checkout use and loading through OMP's `--extension` option remain available.
