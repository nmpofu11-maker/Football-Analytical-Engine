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

const MONTH_MAP: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12"
};

const KNOWN_COMPETITIONS = [
  "Chinese Super League", "CSL",
  "UEFA Champions League", "Champions League", "UCL",
  "UEFA Europa League", "Europa League", "UEL",
  "UEFA Conference League", "Conference League", "UECL",
  "UEFA Friendly / Elite Showcase", "UEFA Friendly", "Elite Showcase", "Friendly Showcase", "Club Friendly", "International Friendly",
  "Premier League", "EPL", "English Premier League", "Championship", "FA Cup", "EFL Cup",
  "DSTV Premiership", "South African PSL", "Premier Soccer League", "PSL", "Nedbank Cup", "MTN8", "Hollywoodbets Super League",
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
 * Converts fractional odds (e.g. "5/2", "17-10", "42-100", "1/1") or decimal strings into decimal number
 * In Hollywoodbets PDF: "17-10" = 17/10 = 2.70 decimal, "42-100" = 42/100 = 1.42 decimal.
 */
export function parseOdd(val: string): number | null {
  if (!val) return null;
  const clean = val.trim();
  
  // Fractional format e.g. 5/2, 17-10, 42-100, 11/4
  const fracMatch = clean.match(/^(\d{1,4})[\/\-](\d{1,4})$/);
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
 * Parses date strings in Hollywoodbets headers
 * e.g. "TODAY's Games (FRIDAY 25 September)" or "Saturday's Games (26 September)" or "Friday 25 Sep 2026"
 */
function parseHollywoodbetsHeaderDate(line: string, defaultDate: string): string | null {
  const currentYear = new Date().getFullYear();

  // Pattern: "(FRIDAY 25 September)" or "(26 September)"
  const bracketMatch = line.match(/\((\w+)?\s*(\d{1,2})\s+([a-zA-Z]+)\)/i);
  if (bracketMatch) {
    const day = bracketMatch[2].padStart(2, "0");
    const mStr = bracketMatch[3].toLowerCase();
    const month = MONTH_MAP[mStr] || "09";
    return `${currentYear}-${month}-${day}`;
  }

  // Pattern: "Friday 25 Sep 2026" or "25 September 2026"
  const fullDateMatch = line.match(/(\d{1,2})\s+([a-zA-Z]+)\s+(202\d)/i);
  if (fullDateMatch) {
    const day = fullDateMatch[1].padStart(2, "0");
    const mStr = fullDateMatch[2].toLowerCase();
    const month = MONTH_MAP[mStr] || "09";
    const year = fullDateMatch[3];
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * Robust Hollywoodbets / Bookmaker Raw Text & PDF Ingestion Parser
 * Ingests text extracted from PDF files or pasted clipboard text from Hollywoodbets, Betway, Bet365, etc.
 */
export function parseBookmakerRawText(rawText: string, defaultDate?: string): ParseResult {
  const slateDate = defaultDate || getTodayDateStr();
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const matches: ParsedBookmakerMatch[] = [];
  const unparsedLines: string[] = [];

  let currentCompetition = "Hollywoodbets Regional Slate";
  let activeDate = slateDate;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for Hollywoodbets date headers e.g. "TODAY's Games (FRIDAY 25 September)"
    const parsedHeaderDate = parseHollywoodbetsHeaderDate(line, slateDate);
    if (parsedHeaderDate) {
      activeDate = parsedHeaderDate;
      continue;
    }

    // Check ISO date markers e.g. "2026-09-25" or "25/09"
    const isoDateMatch = line.match(/\b(202\d-\d{2}-\d{2})\b/);
    if (isoDateMatch) {
      activeDate = isoDateMatch[1];
    } else {
      const dmMatch = line.match(/\b(\d{1,2})[/.-](\d{1,2})\b/);
      if (dmMatch && !line.match(/\b(vs|v)\b/i) && !line.match(/\d+[\/\-]\d+/)) {
        const day = dmMatch[1].padStart(2, "0");
        const month = dmMatch[2].padStart(2, "0");
        const year = new Date().getFullYear();
        activeDate = `${year}-${month}-${day}`;
      }
    }

    // Check if line indicates country / competition header in Hollywoodbets format
    // e.g. "ALGERIA, ALGERIA LEAGUE U20", "ENGLAND, FA TROPHY", "CHINA, CHINA LEAGUE"
    if (
      line.match(/^[A-Z\s]+,\s+[A-Z0-9\s\.\/]+$/) ||
      line.match(/^(soccer|football|league|premier|championship|cup|division|serie|la liga|bundesliga|csl)/i) ||
      (line.includes(" - ") && !line.match(/\b(vs|v)\b/i) && !line.match(/\d+\.\d+/) && !line.match(/\d+[\/\-]\d+/))
    ) {
      currentCompetition = line.replace(/^(soccer\s*[-:]?\s*)/i, "").trim();
      continue;
    }

    // Extract kickoff time if present (e.g. 19:30, 11:00, 14:00)
    const timeMatch = line.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const kickoffTime = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : "18:00";

    // Pattern 1: Hollywoodbets PDF format line:
    // e.g. "14:00 ARSENAL DE SARAN v TALLERES REMEDIO 1268 5-10 29-10 39-10 1-6 1-10 12-10"
    // e.g. "11:00 CR BELOUIZDAD U2 v KOUBA U20 885 42-100 33-10 17-4 2-13 1-10 15-10"
    // e.g. "ARSENAL DE SARAN vs TALLERES REMEDIO 1268 1.50 3.90 4.90"
    const hwMatch = line.match(/^(?:([01]?\d|2[0-3]):([0-5]\d)\s+)?(.*?)\s+(?:v|vs)\s+(.*?)(?:\s+(\d{1,5}))?\s+([\d\.\/\-]+)\s+([\d\.\/\-]+)\s+([\d\.\/\-]+)(.*)$/i);

    if (hwMatch) {
      const leftPart = hwMatch[3].trim();
      const rightPart = hwMatch[4].trim();
      const coupCode = hwMatch[5] || "";
      const rawHomeOdd = hwMatch[6];
      const rawDrawOdd = hwMatch[7];
      const rawAwayOdd = hwMatch[8];

      const homeOdd = parseOdd(rawHomeOdd);
      const drawOdd = parseOdd(rawDrawOdd);
      const awayOdd = parseOdd(rawAwayOdd);

      if (homeOdd && drawOdd && awayOdd && leftPart.length > 1 && rightPart.length > 1) {
        const { cleanAway, competition: finalComp } = extractCompetitionAndTeam(rightPart, currentCompetition);
        const homeName = matchCanonicalTeam(leftPart);
        if (!homeName || !cleanAway || homeName.length <= 1 || cleanAway.length <= 1) {
          unparsedLines.push(line);
          continue;
        }

        const probs = calculateProbabilityDistribution(homeOdd, drawOdd, awayOdd);
        const compositeKey = getFixtureCompositeKey(homeName, cleanAway, activeDate);
        const wasDerby = line.toLowerCase().includes("derby") || finalComp.toLowerCase().includes("derby");

        const fixture: Fixture = {
          id: `hw-${compositeKey}`,
          date: activeDate,
          time: kickoffTime,
          homeTeam: homeName,
          awayTeam: cleanAway,
          competition: finalComp,
          wasDerby,
          source: "bookmaker-import",
          isBookmakerProtected: true,
          sourceConfidence: "verified",
          odds: { home: homeOdd, draw: drawOdd, away: awayOdd },
          probabilities: probs
        };

        matches.push({
          fixture,
          rawLine: line,
          compositeKey,
          impliedProbabilities: probs,
          oddsDecimals: { home: homeOdd, draw: drawOdd, away: awayOdd }
        });
        continue;
      }
    }

    // Pattern 2: Generic "vs" / "v" separator for text clipboard paste
    const vsSeparator = line.match(/\s+(?:vs|v|-)\s+/i);
    const oddsRegex = /\b(\d+\.\d{1,2}|\d+[\/\-]\d+|\d+)\b/g;
    const oddsFound = Array.from(line.matchAll(oddsRegex)).map(m => m[0]);

    if (vsSeparator && vsSeparator.index !== undefined) {
      const separatorIdx = vsSeparator.index;
      const separatorLength = vsSeparator[0].length;
      
      let leftPart = line.substring(0, separatorIdx).trim();
      let rightPart = line.substring(separatorIdx + separatorLength).trim();

      leftPart = leftPart
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
        .replace(/\b\d{1,2}[/.-]\d{1,2}\b/g, "")
        .replace(/\b[012]?\d:[0-5]\d\b/g, "")
        .trim();

      let homeOdd: number | null = null;
      let drawOdd: number | null = null;
      let awayOdd: number | null = null;

      const labeledMatch = rightPart.match(/1[:\s]+([\d\.\/\-]+)\s+X[:\s]+([\d\.\/\-]+)\s+2[:\s]+([\d\.\/\-]+)/i);
      if (labeledMatch) {
        homeOdd = parseOdd(labeledMatch[1]);
        drawOdd = parseOdd(labeledMatch[2]);
        awayOdd = parseOdd(labeledMatch[3]);
        rightPart = rightPart.replace(labeledMatch[0], "").trim();
      } else if (oddsFound.length >= 3) {
        const last3 = oddsFound.slice(-3);
        homeOdd = parseOdd(last3[0]);
        drawOdd = parseOdd(last3[1]);
        awayOdd = parseOdd(last3[2]);
      } else if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextOdds = Array.from(nextLine.matchAll(oddsRegex)).map(m => m[0]);
        if (nextOdds.length >= 3) {
          homeOdd = parseOdd(nextOdds[0]);
          drawOdd = parseOdd(nextOdds[1]);
          awayOdd = parseOdd(nextOdds[2]);
          i++; // consume next line
        }
      }

      let awayName = rightPart
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
        .replace(/\b\d{1,2}[/.-]\d{1,2}\b/g, "")
        .replace(/\b[012]?\d:[0-5]\d\b/g, "");
      
      if (homeOdd && drawOdd && awayOdd) {
        awayName = awayName.replace(new RegExp(`\\b(${homeOdd}|${drawOdd}|${awayOdd})\\b`, "g"), "");
      }
      
      const { cleanAway, competition: finalComp } = extractCompetitionAndTeam(awayName, currentCompetition);
      const homeName = matchCanonicalTeam(leftPart);

      if (homeName && cleanAway && homeName.length > 1 && cleanAway.length > 1 && homeOdd && drawOdd && awayOdd) {
        const probs = calculateProbabilityDistribution(homeOdd, drawOdd, awayOdd);
        const compositeKey = getFixtureCompositeKey(homeName, cleanAway, activeDate);
        const wasDerby = line.toLowerCase().includes("derby") || finalComp.toLowerCase().includes("derby");

        const fixture: Fixture = {
          id: `bookmaker-${compositeKey}`,
          date: activeDate,
          time: kickoffTime,
          homeTeam: homeName,
          awayTeam: cleanAway,
          competition: finalComp,
          wasDerby,
          source: "bookmaker-import",
          isBookmakerProtected: true,
          sourceConfidence: "verified",
          odds: { home: homeOdd, draw: drawOdd, away: awayOdd },
          probabilities: probs
        };

        matches.push({
          fixture,
          rawLine: line,
          compositeKey,
          impliedProbabilities: probs,
          oddsDecimals: { home: homeOdd, draw: drawOdd, away: awayOdd }
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
