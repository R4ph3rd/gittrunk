# AI feature

Provider-agnostic AI assistance (Anthropic by default). All HTTP happens in Rust; the webview never sees keys. Nothing is sent unless AI is enabled in settings, and the first action per session shows the exact payload for confirmation.

Import from `@/features/ai`.

## Mount once (orchestrator)

`<AiHost />` inside `QueryClientProvider`, next to `CommandHost` and `SettingsHost`. It registers the `ai.settings` ("AI settings") and `ai.ask` ("Ask AI…", `mod+shift+i`, needs an open repo) commands and renders the settings, Ask AI and PR-description dialogs. The Settings screen links to the `ai.settings` id.

## Reusable pieces

```tsx
// Sparkle button: payload preview on first use per session, then fills the result.
<AiCommitMessageButton repoId={id} onResult={(text) => setMessage(text)} />

// Conflict resolver extension point: suggest?: (file) => Promise<string>
suggest={(file) => suggestConflictResolution(repoId, file.path)}

// Summary in a popover; target is { kind: "commit", oid } or { kind: "branch", name, base }.
<AiSummaryButton repoId={id} target={{ kind: "commit", oid }} />

// Controlled PR description dialog, or store-driven via the host:
<AiPrDescriptionDialog repoId={id} base="main" head="feat/x" open={open} onOpenChange={setOpen} />
openPrDescription({ repoId: id, base: "main", head: "feat/x" });
```

Also exported: `openAiSettings()`, `openAskAi(repoId)`. Errors with kind `aiDisabled` produce a toast with an "AI settings" action.

## Testing

`testing.ts` provides `aiBindingsMock()` (for `vi.mock("@/ipc/bindings", ...)`) and `installAiBackend(commands)`; see `ai.test.tsx`.
