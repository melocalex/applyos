import React from "react";
import { Download, Trash2, Upload } from "lucide-react";
import {
  CUSTOM_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  findOpenRouterModel,
  isKnownOpenRouterModel,
  OPENROUTER_MODEL_GROUPS
} from "../../shared/openRouterModels";
import type { Settings } from "../../shared/types";
import { Button, Card, Field, Notice } from "../components/UI";
import { AiPromptsCard } from "./AiPromptsCard";

export function SettingsTab({ settings, onSave, onExportAll, onImportAll, onClear }: { settings: Settings; onSave: (settings: Settings) => void; onExportAll: () => void; onImportAll: (file: File) => void; onClear: () => void }) {
  const [draft, setDraft] = React.useState(settings);
  const lastIncoming = React.useRef(JSON.stringify(settings));
  React.useEffect(() => {
    // refresh() creates fresh object identities; only reset the draft when the
    // stored settings actually changed, so background refreshes don't wipe edits.
    const incoming = JSON.stringify(settings);
    if (incoming === lastIncoming.current) return;
    lastIncoming.current = incoming;
    setDraft(settings);
  }, [settings]);
  return (
    <div className="stack">
      <div className="section-heading"><div><h1>Settings</h1><p>External AI is optional, disabled by default, and always user-triggered.</p></div></div>
      <Card className="form-grid">
        <Notice tone="success">Local-only mode keeps CV text, profiles, answers, jobs, queued URLs, and scans on this device. ApplyOS has no backend and no telemetry.</Notice>
        <Toggle label="Local-only mode" checked={draft.localOnlyMode} onChange={(value) => setDraft({ ...draft, localOnlyMode: value })} hint="Must be OFF for OpenRouter AI answers. Click Save Settings after changing." />
        <Field label="OpenRouter API key" hint="Stored locally. No hardcoded secrets."><input type="password" value={draft.openRouterApiKey ?? ""} onChange={(e) => setDraft({ ...draft, openRouterApiKey: e.target.value })} /></Field>
        <OpenRouterModelField
          model={draft.openRouterModel}
          onChange={(openRouterModel) => setDraft({ ...draft, openRouterModel })}
        />
        <Toggle label="Smart Match enabled" checked={draft.smartMatchEnabled} onChange={(value) => setDraft({ ...draft, smartMatchEnabled: value })} />
        <Toggle label="Use optimized multi-CV database for answers" checked={draft.useOptimizedExperienceDatabase} onChange={(value) => setDraft({ ...draft, useOptimizedExperienceDatabase: value })} hint="When enabled, Generate All Answers sends the merged markdown database (Experience tab) with the humanizer prompt instead of the single structured profile JSON." />
        <Toggle label="Auto-save new screening answers" checked={draft.autoSaveNewAnswers} onChange={(value) => setDraft({ ...draft, autoSaveNewAnswers: value })} hint="Saves reusable screening and application answers as you complete a page. Sensitive self-identification answers stay excluded." />
        <Toggle label="Auto-save sensitive self-identification answers" checked={draft.autoSaveSensitiveAnswers} onChange={(value) => setDraft({ ...draft, autoSaveSensitiveAnswers: value })} hint="Off by default. When enabled, demographic, disability, veteran, age, pronoun, and voluntary-disclosure answers may be stored locally." />
        <Toggle label="Auto-insert fields on scan" checked={draft.autoInsertFields} onChange={(value) => setDraft({ ...draft, autoInsertFields: value })} hint="After scanning, fills profile fields and high-confidence Answer Bank matches into the page. Generated answers insert automatically after Generate All Answers." />
        <Toggle label="Auto-generate AI answers on scan" checked={draft.autoGenerateAnswersOnScan} onChange={(value) => setDraft({ ...draft, autoGenerateAnswersOnScan: value })} hint="When Local-only mode is off and an OpenRouter key is set, custom application questions are answered in one batch after each scan. Answers are saved to your Answer Bank." />
        <Field
          label="Job search context (open-ended answers)"
          hint="Paste your reason for looking, career goals, and positioning. OpenRouter uses this with your CV for questions like “Why are you looking for a change?” and similar free-text prompts."
        >
          <textarea
            rows={10}
            value={draft.jobSearchContext ?? ""}
            onChange={(event) => setDraft({ ...draft, jobSearchContext: event.target.value })}
            placeholder="Explain why you are searching now, what roles you want, and the story behind your career move…"
          />
        </Field>
        <Toggle label="Show data before sending" checked={draft.showDataBeforeSending} onChange={(value) => setDraft({ ...draft, showDataBeforeSending: value })} />
        <Toggle label="Allow raw CV for extraction" checked={draft.allowRawCvForExtraction} onChange={(value) => setDraft({ ...draft, allowRawCvForExtraction: value })} />
        <Field label={`Job fit threshold: ${draft.jobFitThreshold}%`}><input type="range" min="0" max="100" value={draft.jobFitThreshold} onChange={(e) => setDraft({ ...draft, jobFitThreshold: Number(e.target.value) })} /></Field>
        <Field label="Queue open behavior" hint="Controls only user-triggered Open, Start Review, Next, and Previous actions.">
          <select value={draft.queueOpenBehavior} onChange={(e) => setDraft({ ...draft, queueOpenBehavior: e.target.value as Settings["queueOpenBehavior"] })}>
            <option value="current_tab">Open in current tab</option>
            <option value="new_tab">Open in new tab</option>
            <option value="background_tab">Open in background tab</option>
          </select>
        </Field>
        <Toggle label="Auto-scan after opening (prompt only)" checked={draft.queueAutoScanAfterOpening} onChange={(value) => setDraft({ ...draft, queueAutoScanAfterOpening: value })} />
        <Toggle label="Queue dev mode: allow localhost URLs" checked={draft.queueDevMode} onChange={(value) => setDraft({ ...draft, queueDevMode: value })} />
        <Button variant="primary" onClick={() => onSave({ ...draft, id: "default" })}>Save Settings</Button>
        <Notice tone="info">Prompt edits above are part of settings. Click Save Settings to persist them.</Notice>
      </Card>
      <AiPromptsCard
        settings={draft}
        onChange={(next) => setDraft(next)}
      />
      <Card>
        <h2>Local data</h2>
        <p>Export a local backup or clear this device. Your OpenRouter API key is never included in exports.</p>
        <div className="button-row">
          <Button onClick={onExportAll}><Download size={16} /> Export All</Button>
          <label className="button button-secondary"><Upload size={16} /> Import All<input className="sr-only" type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && onImportAll(e.target.files[0])} /></label>
          <Button variant="danger" onClick={onClear}><Trash2 size={16} /> Clear Local Data</Button>
        </div>
      </Card>
    </div>
  );
}

function OpenRouterModelField({
  model,
  onChange
}: {
  model?: string;
  onChange: (model: string) => void;
}) {
  const known = isKnownOpenRouterModel(model);
  const selected = known ? model! : CUSTOM_OPENROUTER_MODEL;
  const active = findOpenRouterModel(known ? model : undefined);

  return (
    <Field
      label="OpenRouter model"
      hint={active?.hint ?? "Pick a preset or enter a custom OpenRouter model ID."}
    >
      <select
        value={selected}
        onChange={(event) => {
          const value = event.target.value;
          if (value === CUSTOM_OPENROUTER_MODEL) {
            onChange(known ? model! : DEFAULT_OPENROUTER_MODEL);
            return;
          }
          onChange(value);
        }}
      >
        {OPENROUTER_MODEL_GROUPS.map((group) => (
          <optgroup key={group.provider} label={group.provider}>
            {group.models.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={CUSTOM_OPENROUTER_MODEL}>Custom model ID…</option>
      </select>
      {selected === CUSTOM_OPENROUTER_MODEL ? (
        <input
          style={{ marginTop: 8 }}
          value={model ?? ""}
          placeholder="provider/model-name"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : active ? (
        <p className="subtle" style={{ marginTop: 8 }}>{active.id}</p>
      ) : null}
    </Field>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string }) {
  return (
    <label className="toggle toggle-card">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint ? <small className="subtle" style={{ display: "block", marginTop: 4 }}>{hint}</small> : null}</span>
    </label>
  );
}
