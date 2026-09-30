import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  SegmentedControl,
  Switch,
  toast,
} from "@/design/components";
import { commands, type AiProviderKind, type AiSettings } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { queryKeys } from "@/ipc/queries";
import { useAiStore } from "@/stores/ai";
import { DEFAULT_MODELS, PROVIDER_NAMES, errorMessage, loadAiSettings } from "./api";

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-sm text-fg-muted">{hint}</p> : null}
    </div>
  );
}

function Form({ initial, onClose }: { initial: AiSettings; onClose: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<AiSettings>) => setDraft((d) => ({ ...d, ...p }));
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.aiSettings });

  // Provider changes are persisted immediately so `hasKey` reflects the new provider.
  const changeProvider = async (provider: AiProviderKind) => {
    const other = provider === "anthropic" ? "openAiCompatible" : "anthropic";
    const model = draft.model === DEFAULT_MODELS[other] ? DEFAULT_MODELS[provider] : draft.model;
    try {
      setDraft(await unwrap(commands.aiSettingsSet({ ...draft, provider, model })));
      setKey("");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const saveKey = async () => {
    try {
      await unwrap(commands.aiKeySet(draft.provider, key.trim()));
      setKey("");
      patch({ hasKey: true });
      toast.success("API key stored in the OS keychain");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const clearKey = async () => {
    try {
      await unwrap(commands.aiKeyClear(draft.provider));
      patch({ hasKey: false });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await unwrap(
        commands.aiSettingsSet({
          ...draft,
          baseUrl: draft.baseUrl?.trim() ? draft.baseUrl.trim() : null,
        }),
      );
      setDraft(saved);
      refresh();
      toast.success("AI settings saved");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const providerName = PROVIDER_NAMES[draft.provider];
  const compat = draft.provider === "openAiCompatible";

  return (
    <>
      <DialogHeader>
        <DialogTitle>AI settings</DialogTitle>
        <DialogDescription>
          Repository content is sent to {providerName} only when you use an AI action.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="ai-enabled" className="text-base text-fg">
              Enable AI assistance
            </Label>
            <p className="text-sm text-fg-muted">
              Off by default. While off, nothing leaves this machine.
            </p>
          </div>
          <Switch
            id="ai-enabled"
            checked={draft.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
          />
        </div>

        <Field label="Provider">
          <SegmentedControl<AiProviderKind>
            aria-label="Provider"
            value={draft.provider}
            onValueChange={(p) => void changeProvider(p)}
            options={[
              { value: "anthropic", label: "Anthropic" },
              { value: "openAiCompatible", label: "OpenAI-compatible" },
            ]}
          />
        </Field>

        <Field label="Model" htmlFor="ai-model">
          <Input
            id="ai-model"
            value={draft.model}
            onChange={(e) => patch({ model: e.target.value })}
          />
        </Field>

        {compat ? (
          <Field
            label="Base URL"
            htmlFor="ai-base-url"
            hint="OpenAI, Azure-style gateways, Ollama or LM Studio, e.g. http://localhost:11434/v1. A key is optional for localhost."
          >
            <Input
              id="ai-base-url"
              placeholder="https://api.openai.com/v1"
              value={draft.baseUrl ?? ""}
              onChange={(e) => patch({ baseUrl: e.target.value })}
            />
          </Field>
        ) : null}

        <Field label="API key" htmlFor="ai-key">
          {draft.hasKey ? (
            <div className="flex items-center gap-2">
              <Badge variant="success">Key stored</Badge>
              <span className="text-sm text-fg-muted">in the OS keychain</span>
              <Button size="sm" onClick={() => void clearKey()}>
                Clear
              </Button>
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (key.trim()) void saveKey();
              }}
            >
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your API key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <Button type="submit" disabled={!key.trim()}>
                Save key
              </Button>
            </form>
          )}
        </Field>

        <Field
          label="Max diff size (KB)"
          htmlFor="ai-max-diff"
          hint="Larger diffs are cut at file boundaries before sending."
        >
          <Input
            id="ai-max-diff"
            type="number"
            min={1}
            max={1000}
            value={Math.round(draft.maxDiffBytes / 1000)}
            onChange={(e) =>
              patch({ maxDiffBytes: Math.max(1, Number(e.target.value) || 1) * 1000 })
            }
          />
        </Field>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={() => void save()}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

function Loader({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadAiSettings().then(
      (s) => live && setSettings(s),
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  if (settings) return <Form initial={settings} onClose={onClose} />;
  return (
    <>
      <DialogHeader>
        <DialogTitle>AI settings</DialogTitle>
        <DialogDescription>{error ?? "Loading..."}</DialogDescription>
      </DialogHeader>
      {error ? (
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      ) : null}
    </>
  );
}

/** AI settings dialog, opened with `openAiSettings()` or the "AI settings" command. */
export function AiSettingsDialog() {
  const open = useAiStore((s) => s.settingsOpen);
  const close = useAiStore((s) => s.closeSettings);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <Loader onClose={close} />
      </DialogContent>
    </Dialog>
  );
}
