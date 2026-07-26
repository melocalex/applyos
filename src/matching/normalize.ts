export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // Drop sentence-ending periods while preserving technology names such as
    // .NET and Node.js.
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function tokenize(value: string): string[] {
  return uniqueStrings(
    normalizeText(value)
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}
