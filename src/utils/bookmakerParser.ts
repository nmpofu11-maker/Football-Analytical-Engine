import { Fixture } from "../data/fixtures";
import { getFixtureCompositeKey } from "./fixtureDedupe";
import { getTodayDateStr } from "./dateUtils";
import { LOCKED_80_TEAMS } from "../data/favoriteTeams";

export interface ParsedBookmakerMatch {
  fixture: Fixture;
  rawLine: string;
  compositeKey: string;
  impliedProbabilities: {
    homeWinPct: number;
    drawPct: number;
    awayWinPct: number;
    marginPct: number;
  };
  oddsDecimals: {
    home: number;
    draw: number;
    away: number;
  };
}

export interface ParseResult {
  matches: ParsedBookmakerMatch[];
  unparsedLines: string[];
  totalParsed: number;
  slateDate: string;
}

const KNOWN_COMPETITIONS = [
  "Chinese Super League", "CSL",
  "UEFA Champions League", "Champions League", "UCL",
  "UEFA Europa League", "Europa League", "UEL",
  "UEFA Conference League", "Conference League", "UECL",
  "UEFA Friendly / Elite Showcase", "UEFA Friendly", "Elite Showcase", "Friendly Showcase", "Club Friendly", "International Friendly",
  "Premier League", "EPL", "English Premier League", "Championship", "FA Cup", "EFL Cup",
  "DSTV Premiership", "South African PSL", "Premier Soccer League", "PSL", "Nedbank Cup", "MTN8",
  "Ligue 1", "Ligue 2", "Coupe de France",
  "Serie A", "Serie B", "Coppa Italia",
  "La Liga", "LaLiga", "Segunda Division", "Copa del Rey",
  "Bundesliga", "2. Bundesliga", "DFB-Pokal",
  "Eredivisie", "KNVB Beker",
  "Allsvenskan", "Superettan", "Division 1",
  "Eliteserien", "OBOS-ligaen",
  "J1 League", "J2 League", "Emperor's Cup",
  "K League 1", "K League 2"
];

/**
 * Converts fractional odds (e.g. "5/2", "11/4", "1/1") or decimal strings into decimal number
 */
function parseOdd(val: string): number | null {
  if (!val) return null;
  const clean = val.trim();
  
  // Fractional format e.g. 5/2 or 10/11
  const fracMatch = clean.match(/^(\d{1,4})\/(\d{1,4})$/);
  if (fracMatch) {
    const num = parseFloat(fracMatch[1]);
    const den = parseFloat(fracMatch[2]);
    if (den > 0) {
      return Number((1 + num / den).toFixed(2));
    }
  }

  // Decimal format e.g. 1.85, 2.30, 11.5
  const dec = parseFloat(clean);
  if (!isNaN(dec) && dec > 1.0) {
    return Number(dec.toFixed(2));
  }

  return null;
}

/**
 * Computes margin-free mathematical probability distribution from decimal odds
 */
export function calculateProbabilityDistribution(homeOdd: number, drawOdd: number, awayOdd: number) {
  const pHomeRaw = 1 / homeOdd;
  const pDrawRaw = 1 / drawOdd;
  const pAwayRaw = 1 / awayOdd;
  const total = pHomeRaw + pDrawRaw + pAwayRaw;
  const marginPct = Number(((total - 1) * 100).toFixed(2));

  const homeWinPct = Number(((pHomeRaw / total) * 100).toFixed(1));
  const drawPct = Number(((pDrawRaw / total) * 100).toFixed(1));
  const awayWinPct = Number(((pAwayRaw / total) * 100).toFixed(1));

  return {
    homeWinPct,
    drawPct,
    awayWinPct,
    marginPct
  };
}

/**
 * Cleans team names by removing trailing odds, record tags, or stray numbers
 */
function sanitizeTeamName(name: string): string {
  return name
    .replace(/\b(1|X|2)\b/g, "")
    .replace(/[()[\]{}]/g, "")
    .replace(/\b\d+(\.\d+)?\b/g, "") // remove numeric artifacts
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Robustly separates the away team name from any trailing competition string
 */
function extractCompetitionAndTeam(rawAway: string, currentComp: string): { cleanAway: string; competition: string } {
  let text = sanitizeTeamName(rawAway);
  let comp = currentComp;

  for (const kc of KNOWN_COMPETITIONS) {
    const escaped = kc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(text)) {
      comp = kc;
      text = text.replace(regex, "").trim();
      break;
    }
  }

  // Check if text matches or starts with one of our locked 80 target teams
  const lockedMatch = LOCKED_80_TEAMS.find(t => text.toLowerCase().startsWith(t.toLowerCase()));
  if (lockedMatch) {
    const remainder = text.substring(lockedMatch.length).trim();
    if (remainder.length > 2 && (comp === "Bookmaker Regional Slate" || comp.startsWith("Hollywoodbets"))) {
      comp = remainder;
    }
    return { cleanAway: lockedMatch, competition: comp };
  }

  const fuzzyMatch = LOCKED_80_TEAMS.find(t => t.toLowerCase() === text.toLowerCase());
  return { cleanAway: fuzzyMatch || text, competition: comp };
}

function matchCanonicalTeam(name: string): string {
  const clean = sanitizeTeamName(name);
  const found = LOCKED_80_TEAMS.find(t => 
    t.toLowerCase() === clean.toLowerCase() ||
    clean.toLowerCase() === t.toLowerCase()
  );
  return found || clean;
}

/**
 * Robust Raw Text Bookmaker Ingestion Parser
 * Ingests raw clipboard text from Hollywoodbets, Betway, Bet365, etc.
 */
export function parseBookmakerRawText(rawText: string, defaultDate?: string): ParseResult {
  const slateDate = defaultDate || getTodayDateStr();
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const matches: ParsedBookmakerMatch[] = [];
  const unparsedLines: string[] = [];

  // Current context tracking across multiline boards
  let currentCompetition = "Bookmaker Regional Slate";
  let activeDate = slateDate;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if line indicates competition / sport header
    if (
      line.match(/^(soccer|football|league|premier|championship|cup|division|serie|la liga|bundesliga|csl)/i) ||
      line.includes(" - ") && !line.match(/\b(vs|v)\b/i) && !line.match(/\d+\.\d+/)
    ) {
      currentCompetition = line.replace(/^(soccer\s*[-:]?\s*)/i, "").trim();
      continue;
    }

    // Check if line is a date marker e.g. "2026-09-25" or "25/09"
    const isoDateMatch = line.match(/\b(202\d-\d{2}-\d{2})\b/);
    if (isoDateMatch) {
      activeDate = isoDateMatch[1];
    } else {
      const dmMatch = line.match(/\b(\d{1,2})[/.-](\d{1,2})\b/);
      if (dmMatch && !line.match(/\b(vs|v)\b/i)) {
        const day = dmMatch[1].padStart(2, "0");
        const month = dmMatch[2].padStart(2, "0");
        const year = new Date().getFullYear();
        activeDate = `${year}-${month}-${day}`;
      }
    }

    // Pattern 1: Inline match with "vs" or "v" and odds (e.g., "Arsenal vs Chelsea 17:30 2.10 3.40 3.20")
    // or Hollywoodbets "1: 2.10 X: 3.40 2: 3.20"
    const vsSeparator = line.match(/\s+(?:vs|v|-)\s+/i);
    const oddsRegex = /\b(\d+\.\d{1,2}|\d+\/\d+)\b/g;
    const oddsFound = Array.from(line.matchAll(oddsRegex)).map(m => m[0]);

    // Extract kickoff time if present (e.g. 19:30 or 15:00)
    const timeMatch = line.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const kickoffTime = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : "18:00";

    if (vsSeparator && vsSeparator.index !== undefined) {
      // Split into left (home) and right (away + odds/meta)
      const separatorIdx = vsSeparator.index;
      const separatorLength = vsSeparator[0].length;
      
      let leftPart = line.substring(0, separatorIdx).trim();
      let rightPart = line.substring(separatorIdx + separatorLength).trim();

      // Remove date / time artifacts from left part
      leftPart = leftPart.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "").replace(/\b\d{1,2}[/.-]\d{1,2}\b/g, "").replace(/\b[012]?\d:[0-5]\d\b/g, "").trim();

      // Check if odds are directly on this line
      let homeOdd: number | null = null;
      let drawOdd: number | null = null;
      let awayOdd: number | null = null;

      // Check for labeled Hollywoodbets style: 1: X.XX X: X.XX 2: X.XX
      const labeledMatch = rightPart.match(/1[:\s]+(\d+(?:\.\d+)?|\d+\/\d+)\s+X[:\s]+(\d+(?:\.\d+)?|\d+\/\d+)\s+2[:\s]+(\d+(?:\.\d+)?|\d+\/\d+)/i);
      if (labeledMatch) {
        homeOdd = parseOdd(labeledMatch[1]);
        drawOdd = parseOdd(labeledMatch[2]);
        awayOdd = parseOdd(labeledMatch[3]);
        rightPart = rightPart.replace(labeledMatch[0], "").trim();
      } else if (oddsFound.length >= 3) {
        // Grab the last 3 odds found on the line
        const last3 = oddsFound.slice(-3);
        homeOdd = parseOdd(last3[0]);
        drawOdd = parseOdd(last3[1]);
        awayOdd = parseOdd(last3[2]);
      } else if (i + 1 < lines.length) {
        // Look ahead to the next line for odds (e.g. "1.85 3.20 4.10")
        const nextLine = lines[i + 1];
        const nextOdds = Array.from(nextLine.matchAll(oddsRegex)).map(m => m[0]);
        if (nextOdds.length >= 3) {
          homeOdd = parseOdd(nextOdds[0]);
          drawOdd = parseOdd(nextOdds[1]);
          awayOdd = parseOdd(nextOdds[2]);
          i++; // consume next line
        }
      }

      // Clean away team name
      let awayName = rightPart
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
        .replace(/\b\d{1,2}[/.-]\d{1,2}\b/g, "")
        .replace(/\b[012]?\d:[0-5]\d\b/g, "");
      
      // Strip odds if they were in the right part
      if (homeOdd && drawOdd && awayOdd) {
        awayName = awayName.replace(new RegExp(`\\b(${homeOdd}|${drawOdd}|${awayOdd})\\b`, "g"), "");
      }
      
      const { cleanAway, competition: finalComp } = extractCompetitionAndTeam(awayName, currentCompetition);
      const homeName = matchCanonicalTeam(leftPart);

      if (homeName && cleanAway && homeName.length > 1 && cleanAway.length > 1) {
        // Default odds if bookmaker line didn't include 3-way odds (e.g. 2.10, 3.25, 3.40)
        const finalHomeOdd = homeOdd || 2.10;
        const finalDrawOdd = drawOdd || 3.25;
        const finalAwayOdd = awayOdd || 3.40;

        const probs = calculateProbabilityDistribution(finalHomeOdd, finalDrawOdd, finalAwayOdd);
        const compositeKey = getFixtureCompositeKey(homeName, cleanAway, activeDate);

        // Derive realistic rank & tactical stats from bookmaker probability
        const isHomeFavored = probs.homeWinPct > probs.awayWinPct;
        const homeRank = isHomeFavored ? Math.max(1, Math.round(10 - probs.homeWinPct / 10)) : Math.min(18, Math.round(8 + probs.awayWinPct / 10));
        const awayRank = !isHomeFavored ? Math.max(1, Math.round(10 - probs.awayWinPct / 10)) : Math.min(18, Math.round(8 + probs.homeWinPct / 10));
        const possessionRatio = Math.min(68, Math.max(38, Math.round(50 + (probs.homeWinPct - probs.awayWinPct) / 3)));
        const opponentLowBlock = probs.homeWinPct > 55 || probs.awayWinPct > 55;
        const wasDerby = line.toLowerCase().includes("derby") || finalComp.toLowerCase().includes("derby");

        const fixture: Fixture = {
          id: `bookmaker-${compositeKey}`,
          date: activeDate,
          time: kickoffTime,
          homeTeam: homeName,
          awayTeam: cleanAway,
          competition: finalComp,
          wasDerby,
          homeRank,
          awayRank,
          homeContinentalGap: 5,
          awayContinentalGap: 5,
          opponentLowBlock,
          hasHighShotAccuracy: probs.homeWinPct > 45,
          possessionRatio,
          source: "bookmaker-import",
          isBookmakerProtected: true,
          odds: {
            home: finalHomeOdd,
            draw: finalDrawOdd,
            away: finalAwayOdd
          },
          probabilities: probs
        };

        matches.push({
          fixture,
          rawLine: line,
          compositeKey,
          impliedProbabilities: probs,
          oddsDecimals: {
            home: finalHomeOdd,
            draw: finalDrawOdd,
            away: finalAwayOdd
          }
        });
      } else {
        unparsedLines.push(line);
      }
    } else {
      unparsedLines.push(line);
    }
  }

  return {
    matches,
    unparsedLines,
    totalParsed: matches.length,
    slateDate: activeDate
  };
}
