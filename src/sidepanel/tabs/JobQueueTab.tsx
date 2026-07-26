import React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  ExternalLink,
  FileJson,
  ListChecks,
  Play,
  ScanSearch,
  Trash2,
  Upload
} from "lucide-react";
import type {
  QueuedJobUrl,
  QueueStatus,
  Settings
} from "../../shared/types";
import { recommendationLabel } from "../lib";
import { Badge, Button, Card, EmptyState, Field, Notice } from "../components/UI";

type QueueFilter =
  | "all"
  | QueueStatus
  | "strong_fit"
  | "good_fit"
  | "partial_fit"
  | "low_fit"
  | "no_fit";

type QueueSort =
  | "imported"
  | "fit_desc"
  | "platform"
  | "company"
  | "status"
  | "newest"
  | "oldest";

interface Props {
  items: QueuedJobUrl[];
  settings: Settings;
  currentQueueId?: string;
  linkedinBulkOpening: boolean;
  onOpenLinkedInExternal: () => void;
  onLinkedInPreScreenChange: (enabled: boolean) => void;
  onImportText: (input: string) => void;
  onOpen: (item: QueuedJobUrl) => void;
  onStartApplySession: (item: QueuedJobUrl) => void;
  onScan: () => void;
  onStatus: (item: QueuedJobUrl, status: QueueStatus) => void;
  onRemove: (id: string) => void;
  onUpdateNotes: (item: QueuedJobUrl, notes: string) => void;
  onStartReview: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onClearCompleted: () => void;
  onClearQueue: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onImportJson: (file: File) => void;
}

const FILTERS: Array<[QueueFilter, string]> = [
  ["all", "All"],
  ["new", "New"],
  ["scanned", "Scanned"],
  ["strong_fit", "Strong Fit"],
  ["good_fit", "Good Fit"],
  ["partial_fit", "Partial Fit"],
  ["low_fit", "Low Fit"],
  ["no_fit", "No Fit"],
  ["applied", "Applied"],
  ["saved", "Saved"],
  ["skipped", "Skipped"],
  ["not_relevant", "Not Relevant"],
  ["manual_review", "Manual Review"],
  ["error", "Error"]
];

export function JobQueueTab(props: Props) {
  const [input, setInput] = React.useState("");
  const [filter, setFilter] = React.useState<QueueFilter>("all");
  const [sort, setSort] = React.useState<QueueSort>("imported");
  const [reviewMode, setReviewMode] = React.useState(false);

  const currentIndex = Math.max(
    0,
    props.items.findIndex((item) => item.id === props.currentQueueId)
  );
  const current = props.items[currentIndex];
  const filtered = sortQueue(
    props.items.filter((item) => matchesFilter(item, filter)),
    sort
  );

  React.useEffect(() => {
    if (!reviewMode || !current) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) return;
      // Cmd+A / Ctrl+R etc. are browser shortcuts, not review actions.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (["n", "s", "k", "a", "r", "o", "p"].includes(key)) event.preventDefault();
      if (key === "n") props.onNext();
      if (key === "s") props.onStatus(current, "saved");
      if (key === "k") props.onStatus(current, "skipped");
      if (key === "a") props.onStatus(current, "applied");
      if (key === "r") props.onScan();
      if (key === "o") props.onOpen(current);
      if (key === "p") props.onStartApplySession(current);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current, props, reviewMode]);

  const stats = queueStats(props.items);

  return (
    <div className="stack">
      <div className="section-heading">
        <div>
          <h1>Job Queue</h1>
          <p>Collect or paste job URLs, then review them one at a time. Nothing is applied in the background.</p>
        </div>
        <Button variant={reviewMode ? "secondary" : "primary"} onClick={() => setReviewMode(!reviewMode)}>
          <ListChecks size={16} /> {reviewMode ? "Queue List" : "Review Mode"}
        </Button>
      </div>

      <Card>
        <Field label="Paste job URLs" hint="Accepts lines, commas, JSON arrays, terminal output, and URLs inside text.">
          <textarea
            rows={7}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Paste job URLs here, one per line"
          />
        </Field>
        <div className="button-row">
          <Button
            variant="primary"
            disabled={!input.trim()}
            onClick={() => {
              props.onImportText(input);
              setInput("");
            }}
          >
            <Upload size={16} /> Import URLs
          </Button>
          <Button onClick={props.onStartReview} disabled={!props.items.length}>
            <Play size={16} /> Start Review
          </Button>
        </div>
      </Card>

      <Card className="scan-card">
        <div className="card-header">
          <div>
            <p className="eyebrow">LinkedIn search helper</p>
            <h2>Open external application pages</h2>
            <p>
              From the active LinkedIn Jobs search, inspect up to 20 loaded roles
              and open company application pages in background tabs.
            </p>
          </div>
        </div>
        <div className="button-row">
          <Button
            variant="primary"
            loading={props.linkedinBulkOpening}
            onClick={props.onOpenLinkedInExternal}
          >
            {!props.linkedinBulkOpening ? <ExternalLink size={16} /> : null}
            {props.linkedinBulkOpening ? "Checking loaded roles…" : "Open External Roles"}
          </Button>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={props.settings.linkedinPreScreenEnabled}
            onChange={(event) =>
              props.onLinkedInPreScreenChange(event.target.checked)
            }
          />
          <span>
            Only open roles at or above my {props.settings.jobFitThreshold}% fit threshold
          </span>
        </label>
        <p className="subtle">
          One confirmation is shown first. Duplicate LinkedIn roles and Easy Apply
          are skipped, and nothing is submitted.
        </p>
      </Card>

      <QueueStats stats={stats} />

      <Card>
        <div className="button-row queue-controls">
          <Button onClick={() => current && props.onOpen(current)} disabled={!current}>
            <ExternalLink size={16} /> Open Current
          </Button>
          <Button onClick={props.onPrevious} disabled={!current || currentIndex === 0}>
            <ArrowLeft size={16} /> Previous Job
          </Button>
          <Button onClick={props.onNext} disabled={!current || currentIndex >= props.items.length - 1}>
            Next Job <ArrowRight size={16} />
          </Button>
          <Button onClick={props.onClearCompleted}>Clear Completed</Button>
          <Button onClick={props.onExportJson}><FileJson size={16} /> Export JSON</Button>
          <Button onClick={props.onExportCsv}><Download size={16} /> Export CSV</Button>
          <label className="button button-secondary">
            <Upload size={16} /> Import Queue
            <input className="sr-only" type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && props.onImportJson(event.target.files[0])} />
          </label>
          <Button variant="danger" onClick={props.onClearQueue}><Trash2 size={16} /> Clear Queue</Button>
        </div>
      </Card>

      {reviewMode ? (
        current ? (
          <ReviewCard
            key={current.id}
            item={current}
            index={currentIndex}
            total={props.items.length}
            onOpen={props.onOpen}
            onStartApplySession={props.onStartApplySession}
            onScan={props.onScan}
            onStatus={props.onStatus}
            onPrevious={props.onPrevious}
            onNext={props.onNext}
            onUpdateNotes={props.onUpdateNotes}
          />
        ) : (
          <EmptyState title="Queue is empty" body="Import job URLs to begin a focused review." />
        )
      ) : (
        <>
          <Card>
            <div className="filter-grid">
              <select value={filter} onChange={(event) => setFilter(event.target.value as QueueFilter)}>
                {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={sort} onChange={(event) => setSort(event.target.value as QueueSort)}>
                <option value="imported">Imported order</option>
                <option value="fit_desc">Fit score high to low</option>
                <option value="platform">Platform</option>
                <option value="company">Company</option>
                <option value="status">Status</option>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </Card>
          {filtered.length ? (
            <div className="stack-sm">
              {filtered.map((item) => (
                <QueueItemCard
                  key={item.id}
                  item={item}
                  isCurrent={item.id === props.currentQueueId}
                  onOpen={props.onOpen}
                  onStartApplySession={props.onStartApplySession}
                  onScan={props.onScan}
                  onStatus={props.onStatus}
                  onRemove={props.onRemove}
                  onUpdateNotes={props.onUpdateNotes}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="No queue items found" body="Import URLs or adjust the current queue filter." />
          )}
        </>
      )}

      <Notice tone="info">
        Queue URLs are stored locally. Open behavior: {recommendationLabel(props.settings.queueOpenBehavior)}. ApplyOS reads the active LinkedIn search only when you click the bulk action and never auto-applies or auto-submits.
      </Notice>
    </div>
  );
}

function QueueStats({ stats }: { stats: ReturnType<typeof queueStats> }) {
  const values = [
    ["Total URLs", stats.total],
    ["New", stats.new],
    ["Reviewing", stats.reviewing],
    ["Applied", stats.applied],
    ["Saved", stats.saved],
    ["Skipped", stats.skipped],
    ["Not Relevant", stats.notRelevant],
    ["Manual Review", stats.manualReview]
  ];
  return (
    <div className="queue-stats">
      {values.map(([label, value]) => (
        <Card key={label} className="queue-stat">
          <strong>{value}</strong>
          <span>{label}</span>
        </Card>
      ))}
    </div>
  );
}

function QueueItemCard({
  item,
  isCurrent,
  onOpen,
  onStartApplySession,
  onScan,
  onStatus,
  onRemove,
  onUpdateNotes
}: {
  item: QueuedJobUrl;
  isCurrent: boolean;
  onOpen: (item: QueuedJobUrl) => void;
  onStartApplySession: (item: QueuedJobUrl) => void;
  onScan: () => void;
  onStatus: (item: QueuedJobUrl, status: QueueStatus) => void;
  onRemove: (id: string) => void;
  onUpdateNotes: (item: QueuedJobUrl, notes: string) => void;
}) {
  return (
    <Card className={isCurrent ? "queue-item queue-item-current" : "queue-item"}>
      <QueueItemSummary item={item} />
      <Field label="Notes">
        <textarea rows={2} defaultValue={item.notes ?? ""} onBlur={(event) => onUpdateNotes(item, event.target.value)} />
      </Field>
      <QueueActions
        item={item}
        onOpen={onOpen}
        onStartApplySession={onStartApplySession}
        onScan={onScan}
        onStatus={onStatus}
        onRemove={onRemove}
      />
    </Card>
  );
}

function ReviewCard({
  item,
  index,
  total,
  onOpen,
  onStartApplySession,
  onScan,
  onStatus,
  onPrevious,
  onNext,
  onUpdateNotes
}: {
  item: QueuedJobUrl;
  index: number;
  total: number;
  onOpen: (item: QueuedJobUrl) => void;
  onStartApplySession: (item: QueuedJobUrl) => void;
  onScan: () => void;
  onStatus: (item: QueuedJobUrl, status: QueueStatus) => void;
  onPrevious: () => void;
  onNext: () => void;
  onUpdateNotes: (item: QueuedJobUrl, notes: string) => void;
}) {
  return (
    <Card className="review-card">
      <p className="eyebrow">Review mode · {index + 1} / {total}</p>
      <QueueItemSummary item={item} />
      <Field label="Notes">
        <textarea rows={4} defaultValue={item.notes ?? ""} onBlur={(event) => onUpdateNotes(item, event.target.value)} />
      </Field>
      <QueueActions
        item={item}
        onOpen={onOpen}
        onStartApplySession={onStartApplySession}
        onScan={onScan}
        onStatus={onStatus}
      />
      <div className="button-row">
        <Button onClick={onPrevious} disabled={index === 0}><ArrowLeft size={16} /> Previous</Button>
        <Button variant="primary" onClick={onNext} disabled={index >= total - 1}>Next <ArrowRight size={16} /></Button>
      </div>
      <p className="subtle">Shortcuts: P apply session · N next · S save · K skip · A applied · R rescan · O open</p>
    </Card>
  );
}

function QueueItemSummary({ item }: { item: QueuedJobUrl }) {
  const fitTone = item.fitScore === undefined ? "neutral" : item.fitScore >= 70 ? "good" : item.fitScore >= 40 ? "warn" : "bad";
  return (
    <>
      <div className="card-header">
        <div>
          <h2>{item.title || item.hostname}</h2>
          <p>{[item.company, item.location].filter(Boolean).join(" · ") || item.url}</p>
        </div>
        {item.fitScore !== undefined ? <Badge tone={fitTone}>{item.fitScore}%</Badge> : null}
      </div>
      <div className="tag-row">
        <Badge tone="blue">{item.platform}</Badge>
        <Badge>{recommendationLabel(item.status)}</Badge>
        {item.fitRecommendation ? <Badge tone={fitTone}>{recommendationLabel(item.fitRecommendation)}</Badge> : null}
        {item.pageType ? <Badge>{recommendationLabel(item.pageType)}</Badge> : null}
      </div>
      {item.error ? <Notice tone="danger">{item.error}</Notice> : null}
    </>
  );
}

function QueueActions({
  item,
  onOpen,
  onStartApplySession,
  onScan,
  onStatus,
  onRemove
}: {
  item: QueuedJobUrl;
  onOpen: (item: QueuedJobUrl) => void;
  onStartApplySession: (item: QueuedJobUrl) => void;
  onScan: () => void;
  onStatus: (item: QueuedJobUrl, status: QueueStatus) => void;
  onRemove?: (id: string) => void;
}) {
  // Two rows: the actions used on every job, then the occasional triage ones.
  // ("Apply / Continue" and the old "Open Later" both set status "opened" —
  // one button is enough.)
  return (
    <>
      <div className="button-row">
        <Button variant="primary" onClick={() => onStartApplySession(item)}>
          <Play size={16} /> Start Apply Session
        </Button>
        <Button onClick={() => onOpen(item)}><ExternalLink size={16} /> Open</Button>
        <Button onClick={onScan}><ScanSearch size={16} /> Scan Current Page</Button>
        <Button onClick={() => onStatus(item, "applied")}>Mark Applied</Button>
      </div>
      <div className="button-row">
        <Button variant="ghost" onClick={() => onStatus(item, "saved")}>Save Job</Button>
        <Button variant="ghost" onClick={() => onStatus(item, "skipped")}>Skip</Button>
        <Button variant="ghost" onClick={() => onStatus(item, "not_relevant")}>Not Relevant</Button>
        <Button variant="ghost" onClick={() => onStatus(item, "manual_review")}>Manual Review</Button>
        {onRemove ? <Button variant="danger" onClick={() => onRemove(item.id)}><Trash2 size={16} /> Remove</Button> : null}
      </div>
    </>
  );
}

function queueStats(items: QueuedJobUrl[]) {
  return {
    total: items.length,
    new: items.filter((item) => item.status === "new").length,
    reviewing: items.filter((item) => ["opened", "scanned"].includes(item.status)).length,
    applied: items.filter((item) => item.status === "applied").length,
    saved: items.filter((item) => item.status === "saved").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    notRelevant: items.filter((item) => item.status === "not_relevant").length,
    manualReview: items.filter((item) => item.status === "manual_review").length
  };
}

function matchesFilter(item: QueuedJobUrl, filter: QueueFilter): boolean {
  if (filter === "all") return true;
  if (["strong_fit", "good_fit", "partial_fit", "low_fit", "no_fit"].includes(filter)) {
    return item.fitRecommendation === filter;
  }
  return item.status === filter;
}

function sortQueue(items: QueuedJobUrl[], sort: QueueSort): QueuedJobUrl[] {
  const result = [...items];
  if (sort === "fit_desc") return result.sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1));
  if (sort === "platform") return result.sort((a, b) => a.platform.localeCompare(b.platform));
  if (sort === "company") return result.sort((a, b) => (a.company ?? "").localeCompare(b.company ?? ""));
  if (sort === "status") return result.sort((a, b) => a.status.localeCompare(b.status));
  if (sort === "newest") return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sort === "oldest") return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
