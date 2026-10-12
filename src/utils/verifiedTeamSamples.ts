import { normalizeTeamName } from "./fixtureDedupe";

type VerifiedResultRecord = {
  id?: unknown;
  matchKey?: unknown;
  homeTeam?: unknown;
  awayTeam?: unknown;
  actualScore?: unknown;
  source?: unknown;
  verifiedAt?: unknown;
  verificationStatus?: unknown;
};

const TRUSTED_PROVIDER_SOURCES = new Set([
  "apifootball",
  "sportapi",
  "sportapiai",
  "sportmonks",
  "footballdata",
  "footballdataorg",
  "therundown",
  "pitchapi",
  "sportdb"
]);

/**
 * Counts distinct, settled result records returned by the server's verified-results
 * endpoint. Manually pasted/imported records are not allowed to open the prediction
 * evidence gate.
 */
export function getVerifiedTeamSampleSize(records: unknown, teamName: string, nowMs = Date.now()): number {
  if (!Array.isArray(records) || !teamName.trim()) return 0;
  const target = normalizeTeamName(teamName);
  if (!target) return 0;

  const seen = new Set<string>();
  for (const value of records) {
    if (!value || typeof value !== "object") continue;
    const record = value as VerifiedResultRecord;
    if (String(record.verificationStatus || "").toLowerCase() === "conflict") continue;
    const home = typeof record.homeTeam === "string" ? normalizeTeamName(record.homeTeam) : "";
    const away = typeof record.awayTeam === "string" ? normalizeTeamName(record.awayTeam) : "";
    if (home !== target && away !== target) continue;

    const score = typeof record.actualScore === "string" ? record.actualScore.trim() : "";
    if (!/^\d+\s*-\s*\d+$/.test(score)) continue;

    const source = typeof record.source === "string"
      ? record.source.toLowerCase().replace(/[^a-z0-9]/g, "")
      : "";
    if (!TRUSTED_PROVIDER_SOURCES.has(source)) continue;

    const verifiedAt = typeof record.verifiedAt === "string" ? Date.parse(record.verifiedAt) : Number.NaN;
    if (!Number.isFinite(verifiedAt) || verifiedAt > nowMs) continue;

    const keyValue = record.matchKey ?? record.id;
    if (keyValue === undefined || keyValue === null || String(keyValue).trim() === "") continue;
    seen.add(String(keyValue));
  }
  return seen.size;
}
