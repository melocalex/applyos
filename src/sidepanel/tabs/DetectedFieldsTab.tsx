import { useState } from "react";
import {
  AlertTriangle,
  Clipboard,
  FileText,
  Pencil,
  RefreshCw,
  Save,
  ScanSearch,
  Sparkles,
  WandSparkles,
  FileSearch
} from "lucide-react";
import {
  DOCUMENT_CATEGORIES,
  EXPERIENCE_QUESTION_CATEGORIES,
  PROFILE_PREFERENCE_CATEGORIES,
  SAFE_PROFILE_CATEGORIES,
  SCREENING_QUESTION_CATEGORIES
} from "../../shared/constants";
import type {
  AnswerSuggestion,
  CvSource,
  DetectedField,
  JobFitScore,
  SavedAnswer,
  ScanResult,
  Settings,
  UserProfile
} from "../../shared/types";
import type { CvRecommendation } from "../../matching/recommendCv";
import { isApplicationQuestionField } from "../../shared/applicationFields";
import { findAnswerMatches } from "../../matching/answerMatcher";
import { profileValueForField, recommendationLabel } from "../lib";
import { Badge, Button, Card, EmptyState, Notice } from "../components/UI";

interface Props {
  scan?: ScanResult;
  scanStale?: boolean;
  fit?: JobFitScore;
  cvSources: CvSource[];
  cvRecommendation?: CvRecommendation;
  answers: SavedAnswer[];
  userProfile?: UserProfile;
  settings: Settings;
  suggestions: Record<string, AnswerSuggestion>;
  loading: boolean;
  aiGenerating?: boolean;
  watchDynamic: boolean;
  onWatchDynamic: (value: boolean) => void;
  onScan: () => void;
  onExtractJobInfo: () => void;
  onInsert: (field: DetectedField, value: string, savedAnswerId?: string) => void;
  onAutofillSafe: (fields: DetectedField[]) => void;
  onSaveJob: (status: "saved" | "applied" | "skipped") => void;
  onSmartMatch: (field: DetectedField, candidates: SavedAnswer[]) => void;
  onSuggestAllAnswers: () => void;
  onSaveCurrentValue: (field: DetectedField) => void;
  onSaveSuggestion: (field: DetectedField, suggestion: AnswerSuggestion) => void;
  onSkip: (field: DetectedField) => void;
  onImproveJob: () => void;
  onRecommendCvWithAi: () => void;
}

export function DetectedFieldsTab(props: Props) {
  const fields = props.scan?.fields ?? [];
  const safe = fields.filter(
    (field) => field.category && SAFE_PROFILE_CATEGORIES.includes(field.category) && !field.isDisabled
  );
  const application = fields.filter((field) => isApplicationQuestionField(field));
  const factual = fields.filter(
    (field) => field.category && PROFILE_PREFERENCE_CATEGORIES.includes(field.category) && !field.isDynamic
  );
  const screening = fields.filter(
    (field) =>
      field.category &&
      SCREENING_QUESTION_CATEGORIES.includes(field.category) &&
      !field.isDisabled &&
      !field.isDynamic
  );
  const documents = fields.filter(
    (field) => field.category && DOCUMENT_CATEGORIES.includes(field.category)
  );
  const dynamic = fields.filter((field) => field.isDynamic);
  const manual = fields.filter(
    (field) =>
      !field.isDynamic &&
      !isApplicationQuestionField(field) &&
      (field.isDisabled ||
        field.category === "manual_review" ||
        !field.category ||
        (!SAFE_PROFILE_CATEGORIES.includes(field.category) &&
          field.category !== "social_profile" &&
          !EXPERIENCE_QUESTION_CATEGORIES.includes(field.category) &&
          !PROFILE_PREFERENCE_CATEGORIES.includes(field.category) &&
          !DOCUMENT_CATEGORIES.includes(field.category) &&
          !SCREENING_QUESTION_CATEGORIES.includes(field.category)))
  );

  const hasJobInfo =
    Boolean(props.scan?.jobInfoExtracted) ||
    Boolean(props.scan?.jobInfo.title) ||
    (props.scan?.jobInfo.requirements.length ?? 0) > 0 ||
    (props.scan?.jobInfo.responsibilities.length ?? 0) > 0;

  return (
    <div className="stack">
      <Card className="scan-card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Current page</p>
            <h2>{props.scan ? recommendationLabel(props.scan.pageType) : "Not scanned yet"}</h2>
          </div>
          <div className="tag-row">
            {props.scan ? <Badge tone="blue">{props.scan.adapterName}</Badge> : null}
            {props.scan?.jobInfoExtracted ? <Badge tone="good">Extracted</Badge> : null}
          </div>
        </div>
        <div className="button-row">
          <Button variant="primary" loading={props.loading} onClick={props.onScan}>
            <ScanSearch size={16} /> {props.scan?.fields.length ? "Rescan Page" : "Scan Page"}
          </Button>
          <Button loading={props.loading} onClick={props.onExtractJobInfo}>
            <FileSearch size={16} /> Extract Job Info
          </Button>
          <label className="toggle">
            <input
              type="checkbox"
              checked={props.watchDynamic}
              onChange={(event) => props.onWatchDynamic(event.target.checked)}
            />
            <span>Watch dynamic fields</span>
          </label>
        </div>
        {props.scanStale ? (
          <Notice tone="warning">
            The page has changed since this scan. Fields, fit score, and CV pick below belong to the
            previous page — rescan before inserting anything.
          </Notice>
        ) : null}
        {props.scan?.message ? <Notice tone="warning">{props.scan.message}</Notice> : null}
        {props.scan ? (
          <p className="subtle">
            {props.scan.fields.length} fields detected · {props.scan.watching ? "Watching" : "Stopped"}
          </p>
        ) : null}
      </Card>

      <div
        className="stale-scan-content stack"
        ref={(element) => {
          if (element) element.inert = Boolean(props.scanStale);
        }}
        aria-disabled={props.scanStale || undefined}
      >
        {hasJobInfo ? (
          <>
            <JobCard {...props} />
            {props.cvSources.length ? <CvRecommendationCard {...props} /> : null}
            <FitCard fit={props.fit} />
          </>
        ) : null}

        {props.scan ? (
          <>
          {props.scan.jobInfoExtracted && fields.length === 0 ? (
            <Notice tone="success">
              Job info is extracted and saved for this role. Click Apply on the page, then Scan Page to detect form fields.
            </Notice>
          ) : null}
          {fields.length === 0 ? (
            <EmptyState
              title="No fields found"
              body="Make sure the application form is visible. ApplyOS will never click Apply for you."
              action={
                <Button onClick={props.onScan}>
                  <RefreshCw size={16} /> Rescan Page
                </Button>
              }
            />
          ) : null}
          <FieldGroup
            title="Safe Profile Fields"
            description="Filled from your saved profile when auto-insert is enabled, or use Insert manually."
            fields={safe}
            action={
              safe.length ? (
                <Button onClick={() => props.onAutofillSafe(safe)}>Autofill All Safe Fields</Button>
              ) : undefined
            }
          >
            {(field) => {
              const value = profileValueForField(field, props.userProfile);
              return (
                <SimpleField
                  field={field}
                  value={value}
                  onInsert={(nextValue) => props.onInsert(field, nextValue)}
                />
              );
            }}
          </FieldGroup>
          {props.fit && application.length && props.fit.overallScore < props.settings.jobFitThreshold ? (
            <Notice tone="warning">
              <AlertTriangle size={16} /> Fit is {props.fit.overallScore}%, below your{" "}
              {props.settings.jobFitThreshold}% threshold. AI answers are still generated for this
              form, so review them carefully before inserting.
            </Notice>
          ) : null}
          <FieldGroup
            title="Application Questions"
            description="Custom questions like visa type, job-change reason, and market experience. AI generates answers on scan when enabled in Settings."
            fields={application}
            action={
              props.aiGenerating ? (
                <Notice tone="info">
                  <strong>AI is drafting answers for this form…</strong>
                </Notice>
              ) : !props.settings.localOnlyMode &&
                props.settings.openRouterApiKey &&
                application.length ? (
                <Button loading={props.loading} onClick={props.onSuggestAllAnswers}>
                  <Sparkles size={16} /> Generate All Answers
                </Button>
              ) : props.settings.localOnlyMode ? (
                <Notice tone="warning">Turn off Local-only mode and add an OpenRouter key to use AI answers.</Notice>
              ) : undefined
            }
          >
            {(field) => (
              <ApplicationQuestion
                field={field}
                answers={props.answers}
                suggestion={props.suggestions[field.fieldId]}
                settings={props.settings}
                onInsert={props.onInsert}
                onSmartMatch={props.onSmartMatch}
                onSaveCurrentValue={props.onSaveCurrentValue}
                onSaveSuggestion={props.onSaveSuggestion}
                onSkip={props.onSkip}
              />
            )}
          </FieldGroup>
          <FieldGroup
            title="Factual / Preference Fields"
            description="Salary, relocation, and start date from your saved profile."
            fields={factual}
          >
            {(field) => {
              const value = profileValueForField(field, props.userProfile);
              return (
                <SimpleField
                  field={field}
                  value={value}
                  onInsert={(nextValue) => props.onInsert(field, nextValue)}
                />
              );
            }}
          </FieldGroup>
          <FieldGroup
            title="Screening & Compliance"
            description="Work authorization, location, timezone, and survey answers. Auto-inserts from Answer Bank on scan when confidence is high."
            fields={screening}
          >
            {(field) => (
              <ApplicationQuestion
                field={field}
                answers={props.answers}
                suggestion={props.suggestions[field.fieldId]}
                settings={props.settings}
                onInsert={props.onInsert}
                onSmartMatch={props.onSmartMatch}
                onSaveCurrentValue={props.onSaveCurrentValue}
                onSaveSuggestion={props.onSaveSuggestion}
                onSkip={props.onSkip}
              />
            )}
          </FieldGroup>
          <FieldGroup
            title="Documents"
            description="File uploads always require manual user action."
            fields={documents}
          >
            {(field) => (
              <SimpleField
                field={field}
                value="Upload manually in the page"
                manual
                onInsert={() => undefined}
              />
            )}
          </FieldGroup>
          <FieldGroup
            title="Dynamic Fields"
            description="These appeared after the form changed or a dependency updated."
            fields={dynamic}
          >
            {(field) => (
              <SimpleField
                field={field}
                value={
                  field.dependsOn?.length
                    ? `Depends on ${field.dependsOn.join(" → ")}`
                    : "Appeared dynamically"
                }
                manual
                onInsert={() => undefined}
              />
            )}
          </FieldGroup>
          <FieldGroup
            title="Manual Review"
            description="Unclear or unsupported fields are never autofilled."
            fields={manual}
          >
            {(field) => (
              <SimpleField
                field={field}
                value="Review and answer manually"
                manual
                onInsert={() => undefined}
              />
            )}
          </FieldGroup>
          </>
        ) : (
          <EmptyState
            title="Scan a job page"
            body="Open a listing, careers page, or application form, then scan it from here."
          />
        )}
      </div>
    </div>
  );
}

function CvRecommendationCard(props: Props) {
  const recommendation = props.cvRecommendation;
  if (!recommendation) return null;

  const recommended = props.cvSources.find((cv) => cv.id === recommendation.recommendedCvId);

  return (
    <Card className="fit-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">CV to upload</p>
          <h2>{recommended?.fileName ?? recommendation.recommendedFileName}</h2>
          {recommended?.positioningLabel ? <p className="subtle">{recommended.positioningLabel}</p> : null}
        </div>
        <Badge tone="good">{Math.round(recommendation.confidence * 100)}% fit</Badge>
      </div>
      <Notice tone="success">
        <strong>{recommendation.method === "openrouter" ? "AI recommendation" : "Local match"}</strong>
        <p>{recommendation.reason}</p>
        {recommended?.whenToUse ? <p>{recommended.whenToUse}</p> : null}
      </Notice>
      {recommended?.localPathHint ? (
        <p className="subtle">
          <FileText size={14} style={{ display: "inline", verticalAlign: "text-bottom" }} /> Upload from:{" "}
          {recommended.localPathHint}
        </p>
      ) : null}
      {recommendation.alternatives.length ? (
        <div className="evidence">
          <strong>Alternatives</strong>
          <ul>
            {recommendation.alternatives.map((alt) => (
              <li key={alt.cvId}>
                <strong>{alt.fileName}</strong> — {alt.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="button-row">
        <Button
          onClick={() =>
            navigator.clipboard.writeText(recommended?.fileName ?? recommendation.recommendedFileName)
          }
        >
          Copy filename
        </Button>
        {recommended?.localPathHint ? (
          <Button onClick={() => navigator.clipboard.writeText(recommended.localPathHint!)}>
            Copy local path
          </Button>
        ) : null}
        {!props.settings.localOnlyMode && props.settings.openRouterApiKey ? (
          <Button loading={props.loading} onClick={props.onRecommendCvWithAi}>
            <Sparkles size={16} /> Refine with AI
          </Button>
        ) : null}
      </div>
      <p className="subtle">
        ApplyOS cannot upload files for you. Use the recommended PDF in the resume field on the page.
      </p>
    </Card>
  );
}

function JobCard(props: Props) {
  const job = props.scan!.jobInfo;
  const hasJob = job.title || job.company || job.description;
  return (
    <Card>
      <div className="card-header">
        <div>
          <p className="eyebrow">Job information</p>
          <h2>{job.title || "Job title not found"}</h2>
          <p>{[job.company, job.location].filter(Boolean).join(" · ") || "No company or location found"}</p>
        </div>
      </div>
      {!hasJob ? <Notice tone="warning">No job information was found on this page.</Notice> : null}
      {props.scan?.jobInfoExtracted ? (
        <Notice tone="success">
          Extracted — requirements and responsibilities are stored for this role and will be sent to the model.
        </Notice>
      ) : null}
      {props.scan?.jobInfoFromListing && !props.scan?.jobInfoExtracted ? (
        <Notice tone="info">
          Requirements loaded from the job listing page
          {job.listingSourceUrl ? ` (${job.listingSourceUrl.replace(/^https?:\/\//, "")})` : ""}.
        </Notice>
      ) : null}
      {job.requirements.length || job.responsibilities.length ? (
        <p className="subtle">
          {job.requirements.length} requirements · {job.responsibilities.length} responsibilities
          {job.niceToHave.length ? ` · ${job.niceToHave.length} nice-to-have` : ""}
        </p>
      ) : null}
      <div className="button-row">
        <Button onClick={() => props.onSaveJob("saved")}>
          <Save size={16} /> Save Job
        </Button>
        <Button onClick={() => props.onSaveJob("applied")}>Mark Applied</Button>
        <Button onClick={() => props.onSaveJob("skipped")}>Mark Skipped</Button>
        {!props.settings.localOnlyMode && props.settings.openRouterApiKey && job.description ? (
          <Button onClick={props.onImproveJob}>
            <Sparkles size={16} /> Improve Extraction
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function FitCard({ fit }: { fit?: JobFitScore }) {
  if (!fit) return null;
  const tone =
    fit.recommendation === "strong_fit" || fit.recommendation === "good_fit"
      ? "good"
      : fit.recommendation === "partial_fit"
        ? "warn"
        : "bad";
  return (
    <Card className="fit-card">
      <div className="score-line">
        <div className={`score score-${tone}`}>{fit.overallScore}%</div>
        <div>
          <p className="eyebrow">Job fit</p>
          <h2>{recommendationLabel(fit.recommendation)}</h2>
          <p>{fit.reason}</p>
        </div>
      </div>
      <div className="score-grid">
        <ScoreItem label="Required skills" value={fit.breakdown.requiredSkills} />
        <ScoreItem label="Experience level" value={fit.breakdown.experienceLevel} />
        <ScoreItem label="Domain fit" value={fit.breakdown.domainFit} />
        <ScoreItem label="Role fit" value={fit.breakdown.roleFit} />
      </div>
      {fit.matchingHighlights.length ? (
        <div className="evidence">
          <strong>Matching highlights</strong>
          <div className="tag-row">
            {fit.matchingHighlights.slice(0, 6).map((item) => (
              <Badge key={item} tone="good">{item}</Badge>
            ))}
          </div>
        </div>
      ) : null}
      {fit.missingRequirements.length ? (
        <div className="evidence">
          <strong>Missing or unclear</strong>
          <ul>
            {fit.missingRequirements.slice(0, 5).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function ScoreItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}%</strong>
    </div>
  );
}

function FieldGroup({
  title,
  description,
  fields,
  action,
  children
}: {
  title: string;
  description: string;
  fields: DetectedField[];
  action?: React.ReactNode;
  children: (field: DetectedField) => React.ReactNode;
}) {
  if (!fields.length) return null;
  return (
    <section className="field-group">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {action}
      </div>
      <div className="stack-sm">{fields.map((field) => <div key={field.fieldId}>{children(field)}</div>)}</div>
    </section>
  );
}

/**
 * Single value action row used everywhere a value can be inserted (profile fields,
 * AI suggestions, answer matches). Insert is the primary action, Edit opens an inline
 * editor (no jarring window.prompt), and Copy is a compact icon button. `extra` slots
 * in context-specific actions like "Save to Answer Bank".
 */
function InsertableValue({
  value,
  insertLabel = "Insert",
  onInsert,
  extra
}: {
  value: string;
  insertLabel?: string;
  onInsert: (value: string) => void;
  extra?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <div className="value-edit">
        <textarea
          rows={Math.min(8, Math.max(3, Math.ceil(draft.length / 50)))}
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="button-row">
          <Button
            variant="primary"
            onClick={() => {
              onInsert(draft);
              setEditing(false);
            }}
          >
            Insert edited
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(value);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="button-row">
      <Button variant="primary" onClick={() => onInsert(value)}>
        {insertLabel}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        <Pencil size={15} /> Edit
      </Button>
      <Button
        variant="ghost"
        className="icon-button"
        title="Copy to clipboard"
        aria-label="Copy to clipboard"
        onClick={() => navigator.clipboard.writeText(value)}
      >
        <Clipboard size={15} />
      </Button>
      {extra}
    </div>
  );
}

function SimpleField({
  field,
  value,
  manual,
  onInsert
}: {
  field: DetectedField;
  value?: string;
  manual?: boolean;
  onInsert: (value: string) => void;
}) {
  return (
    <Card className="field-card">
      <div className="field-title">
        <div>
          <strong>{field.label}</strong>
          <div className="tag-row">
            <Badge>{field.category || "unknown"}</Badge>
            {field.required ? <Badge tone="warn">Required</Badge> : null}
            {field.isDisabled ? <Badge tone="bad">Disabled</Badge> : null}
          </div>
        </div>
      </div>
      <p className={value ? "value-preview" : "subtle"}>{value || "No saved value"}</p>
      {!manual && value ? <InsertableValue value={value} onInsert={onInsert} /> : null}
    </Card>
  );
}

function ApplicationQuestion({
  field,
  answers,
  suggestion,
  settings,
  onInsert,
  onSmartMatch,
  onSaveCurrentValue,
  onSaveSuggestion,
  onSkip
}: {
  field: DetectedField;
  answers: SavedAnswer[];
  suggestion?: AnswerSuggestion;
  settings: Settings;
  onInsert: (field: DetectedField, value: string, savedAnswerId?: string) => void;
  onSmartMatch: (field: DetectedField, candidates: SavedAnswer[]) => void;
  onSaveCurrentValue: (field: DetectedField) => void;
  onSaveSuggestion: (field: DetectedField, suggestion: AnswerSuggestion) => void;
  onSkip: (field: DetectedField) => void;
}) {
  const matches = findAnswerMatches(field, answers, 5).filter((match) => match.confidence >= 0.55);

  return (
    <Card className="field-card">
      <div className="field-title">
        <div>
          <strong>{field.label}</strong>
          <div className="tag-row">
            <Badge>{field.category || "custom_question"}</Badge>
            {field.required ? <Badge tone="warn">Required</Badge> : null}
          </div>
        </div>
      </div>
      {suggestion ? (
        <Notice
          tone={
            suggestion.source === "no_fit"
              ? "danger"
              : suggestion.requiresEditBeforeInsert
                ? "warning"
                : "success"
          }
        >
          <strong>{suggestion.source === "no_fit" ? "NO_FIT" : recommendationLabel(suggestion.source)}</strong>
          {suggestion.requiresEditBeforeInsert && suggestion.answer && suggestion.answer !== "NO_FIT" ? (
            <Badge tone="warn">
              Low confidence ({Math.round((suggestion.confidence ?? 0) * 100)}%) — not auto-inserted, review first
            </Badge>
          ) : null}
          <p>{suggestion.answer || suggestion.reason}</p>
          {suggestion.answer && suggestion.answer !== "NO_FIT" ? (
            <InsertableValue
              value={suggestion.answer}
              onInsert={(value) => onInsert(field, value)}
              extra={
                suggestion.source === "experience_profile" ? (
                  <Button variant="ghost" onClick={() => onSaveSuggestion(field, suggestion)}>
                    Save to Answer Bank
                  </Button>
                ) : undefined
              }
            />
          ) : null}
        </Notice>
      ) : null}
      {matches.length ? (
        <div className="match-list">
          {matches.map(({ answer, confidence }) => (
            <div className="answer-match" key={answer.id}>
              <div className="card-header">
                <strong>{answer.title}</strong>
                <Badge tone={confidence >= 0.7 ? "good" : "warn"}>{Math.round(confidence * 100)}% match</Badge>
              </div>
              <p>{answer.answer}</p>
              <InsertableValue
                value={answer.answer}
                onInsert={(value) => onInsert(field, value, answer.id)}
              />
            </div>
          ))}
        </div>
      ) : (
        <Notice tone="warning">No saved answer match found. ApplyOS will not invent one.</Notice>
      )}
      <div className="button-row">
        {settings.smartMatchEnabled && !settings.localOnlyMode && settings.openRouterApiKey && matches.length ? (
          <Button onClick={() => onSmartMatch(field, matches.map((match) => match.answer))}>
            <WandSparkles size={16} /> Smart Match
          </Button>
        ) : null}
        <Button onClick={() => onSaveCurrentValue(field)}>
          <FileText size={16} /> Save Current Answer
        </Button>
        <Button variant="ghost" onClick={() => onSkip(field)}>Skip</Button>
      </div>
    </Card>
  );
}
