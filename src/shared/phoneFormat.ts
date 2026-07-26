const COUNTRY_DIAL_CODES: Record<string, string> = {
  portugal: "351",
  "united states": "1",
  "united states of america": "1",
  usa: "1",
  "united kingdom": "44",
  uk: "44",
  brazil: "55",
  germany: "49",
  france: "33",
  spain: "34",
  italy: "39",
  netherlands: "31",
  belgium: "32",
  switzerland: "41",
  austria: "43",
  ireland: "353",
  canada: "1",
  australia: "61",
  india: "91",
  singapore: "65",
  japan: "81",
  "south korea": "82",
  china: "86",
  mexico: "52",
  poland: "48",
  sweden: "46",
  norway: "47",
  denmark: "45",
  finland: "358",
  "hong kong": "852",
  taiwan: "886",
  israel: "972",
  "united arab emirates": "971",
  uae: "971"
};

const FALLBACK_DIAL_CODES = [
  "351", "353", "358", "354", "420", "421", "386", "385", "380", "971", "966", "972", "886", "852",
  "880", "855", "856", "234", "254", "27", "44", "49", "33", "39", "34", "31", "32", "41", "43", "45",
  "46", "47", "48", "61", "64", "81", "82", "86", "91", "55", "52", "7", "1"
];

export interface ParsedPhone {
  dialCode?: string;
  national: string;
  countryName?: string;
  e164?: string;
}

function normalizeCountryKey(country?: string): string {
  return (country || "").trim().toLowerCase();
}

export function dialCodeForCountry(country?: string): string | undefined {
  const key = normalizeCountryKey(country);
  if (!key) return undefined;
  return COUNTRY_DIAL_CODES[key];
}

function splitDialCode(digits: string, extraCodes: string[] = []): { dialCode: string; national: string } | undefined {
  const codes = [...new Set([...extraCodes, ...FALLBACK_DIAL_CODES])].sort((left, right) => right.length - left.length);
  for (const code of codes) {
    if (digits.startsWith(code) && digits.length > code.length + 4) {
      return { dialCode: code, national: digits.slice(code.length) };
    }
  }
  return undefined;
}

export function parsePhoneNumber(raw: string, countryHint?: string): ParsedPhone {
  const trimmed = raw.trim();
  if (!trimmed) return { national: "" };

  const countryName = countryHint?.trim() || undefined;
  const hintDial = dialCodeForCountry(countryName);
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (digits.startsWith("+")) digits = digits.slice(1);

  const split = splitDialCode(digits);
  if (split) {
    return {
      dialCode: split.dialCode,
      national: split.national,
      countryName,
      e164: `+${split.dialCode}${split.national}`
    };
  }

  const nationalOnly = digits.replace(/\D/g, "");
  if (hintDial && nationalOnly) {
    return {
      dialCode: hintDial,
      national: nationalOnly,
      countryName,
      e164: `+${hintDial}${nationalOnly}`
    };
  }

  return { national: nationalOnly, countryName };
}

export function formatPhoneForProfile(phone?: string, country?: string): string | undefined {
  const trimmed = phone?.trim();
  if (!trimmed) return undefined;
  if (/^\+|^00/.test(trimmed)) return trimmed;
  const dial = dialCodeForCountry(country);
  const national = trimmed.replace(/\D/g, "");
  if (dial && national) {
    // Users often save an international number without the leading "+". Do
    // not turn a Brazilian "554899..." into "+55554899...".
    if (national.startsWith(dial) && national.length > dial.length + 6) {
      return `+${national}`;
    }
    return `+${dial}${national}`;
  }
  return trimmed;
}
