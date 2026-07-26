import React from "react";
import type { UserProfile } from "../../shared/types";
import { Button, Card, Field } from "../components/UI";

export function ProfileTab({ profile, onSave }: { profile?: UserProfile; onSave: (profile: UserProfile) => void }) {
  const [draft, setDraft] = React.useState<UserProfile>(profile ?? {});
  const lastIncoming = React.useRef(JSON.stringify(profile ?? {}));
  React.useEffect(() => {
    // Only reset on real content changes — background refresh() must not wipe edits.
    const incoming = JSON.stringify(profile ?? {});
    if (incoming === lastIncoming.current) return;
    lastIncoming.current = incoming;
    setDraft(profile ?? {});
  }, [profile]);
  const fields: Array<[keyof UserProfile, string, string]> = [
    ["firstName", "First name", "text"], ["lastName", "Last name", "text"], ["fullName", "Full name", "text"],
    ["email", "Email", "email"],     ["phone", "Phone", "tel"], ["country", "Country", "text"],
    ["state", "State / Province", "text"], ["city", "City (for location search)", "text"],
    ["location", "Full location (free text)", "text"], ["currentCompany", "Current company", "text"],
    ["linkedinUrl", "LinkedIn URL", "url"],
    ["githubUrl", "GitHub URL", "url"], ["portfolioUrl", "Portfolio URL", "url"], ["websiteUrl", "Website URL", "url"],
    ["education", "College / university", "text"], ["referralSource", "How did you hear about us?", "text"],
    ["inOfficePreference", "In-office preference (Yes/No)", "text"],
    ["workAuthorization", "Work authorization (Yes/No)", "text"], ["visaSponsorship", "Visa sponsorship (Yes/No)", "text"],
    ["salaryExpectation", "Salary expectation", "text"], ["startDate", "Start date", "date"]
  ];
  return (
    <div className="stack">
      <div className="section-heading"><div><h1>Profile</h1><p>Safe defaults used only after you click Insert or Autofill.</p></div></div>
      <Card className="form-grid">
        {fields.map(([key, label, type]) => (
          <Field key={key} label={label}>
            <input
              type={type}
              value={String(draft[key] ?? "")}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </Field>
        ))}
        <p className="muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
          Country is used for country pickers (e.g. Brazil (+55)). City is used when a form has a location
          search. Full location is used for plain text location fields. Use Yes/No for work authorization,
          visa sponsorship, and in-office questions on Ashby and similar forms.
        </p>
        <Button variant="primary" onClick={() => onSave({ ...draft, id: "default" })}>Save Profile</Button>
      </Card>
    </div>
  );
}
