import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import * as pdfParseModule from "pdf-parse";
import { LOCKED_80_TEAMS, isFastPacedLeagueTeam } from "./src/data/favoriteTeams";
import { parseBookmakerRawText } from "./src/utils/bookmakerParser";
import { simulateMatchup } from "./src/utils/footballMath";
import { fetchSportApiAiFixtures } from "./src/services/serverSportApiAi";
import { fetchTheRundownFixtures } from "./src/services/serverTheRundown";
import {
  getFixtures, saveFixtures,
  getPredictions, savePredictions, addPrediction,
  getCoefficientHistory, saveCoefficientHistory, addHistoryEntry,
  getMatrices, saveMatrices, applyCalibrationServer
} from "./server-db";

async function extractTextFromPdfBuffer(buffer: Buffer): Promise<{ text: string; totalPages: number }> {
  try {
    const mod = pdfParseModule as any;
    if (mod.PDFParse && typeof mod.PDFParse === "function") {
      const parser = new mod.PDFParse({ data: buffer });
      const res = await parser.getText();
      return { text: res.text || "", totalPages: res.total || res.numpages || 1 };
    }
    const parseFn = mod.default || mod;
    if (typeof parseFn === "function") {
      const res = await parseFn(buffer);
      return { text: res.text || "", totalPages: res.numpages || 1 };
    }
    throw new Error("Unable to initialize PDFParse class or function");
  } catch (err: any) {
    console.error("PDF extraction error details:", err);
    throw err;
  }
}

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Dynamic date helpers to eliminate hardcoded date cutoffs
function getTodayDateStrServer(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function get48HourRollingCutoffServer(): string {
  const d = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Composite key normalization
function normalizeTeamServer(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|afc|ac|as|ssc|cd|fk|sk|bk|if|ff|w|women|ladies|u21|u23|reserves|united|city|rovers|athletic|town)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function getCompositeKeyServer(home: string, away: string, date: string): string {
  const h = normalizeTeamServer(home) || home.toLowerCase().replace(/\s+/g, "");
  const a = normalizeTeamServer(away) || away.toLowerCase().replace(/\s+/g, "");
  return `${h}_vs_${a}_${date}`;
}

// Server Disk Persistence (Zero Data Loss) via server-db.ts
const DATA_DIR = path.join(process.cwd(), "data");
const MANIFEST_FILE = path.join(DATA_DIR, "fixtures-manifest.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getInitialBaselineFixtures(): any[] {
  return [];
}

function loadPersistedFixturesFromDisk(): any[] {
  ensureDataDir();
  if (!fs.existsSync(MANIFEST_FILE)) {
    const initialSeed = getInitialBaselineFixtures();
    saveFixturesToDisk(initialSeed);
    return initialSeed;
  }
  try {
    const raw = fs.readFileSync(MANIFEST_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    const initialSeed = getInitialBaselineFixtures();
    saveFixturesToDisk(initialSeed);
    return initialSeed;
  } catch (e) {
    return getInitialBaselineFixtures();
  }
}

function saveFixturesToDisk(fixtures: any[]): boolean {
  ensureDataDir();
  try {
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(fixtures, null, 2), "utf-8");
    return true;
  } catch (e) {
    return false;
  }
}

// Pre-match prediction simulation using server matrices
function simulateMatchupServer(match: any) {
  const matrices = getMatrices();
  const homeMatrix = matrices[match.homeTeam] || { sample_size_matches: 0, learned_coefficients: { home_advantage_multiplier: 1, form_momentum_weight: 1, volatility_index: 1, fatigue_penalty_modifier: 1 } };
  const awayMatrix = matrices[match.awayTeam] || { sample_size_matches: 0, learned_coefficients: { home_advantage_multiplier: 1, form_momentum_weight: 1, volatility_index: 1, fatigue_penalty_modifier: 1 } };
  const result = simulateMatchup(
    match.homeTeam, match.awayTeam,
    homeMatrix.learned_coefficients, awayMatrix.learned_coefficients,
    match.wasDerby, match.homeRank, match.awayRank,
    match.homeContinentalGap, match.awayContinentalGap,
    match.opponentLowBlock, match.hasHighShotAccuracy, match.possessionRatio,
    homeMatrix.sample_size_matches, awayMatrix.sample_size_matches
  );
  return { result, homeCoefficients: homeMatrix.learned_coefficients, awayCoefficients: awayMatrix.learned_coefficients };
}

function generatePreMatchPredictions(fixtures: any[]) {
  const existingPreds = getPredictions();
  let added = 0;
  for (const f of fixtures) {
    if (f.sourceConfidence === "unknown") continue;
    const matchKey = getCompositeKeyServer(f.homeTeam, f.awayTeam, f.date);
    const alreadyExists = existingPreds.some(p => p.fixture_id === matchKey || p.fixture_id === String(f.id));
    if (!alreadyExists) {
      const sim = simulateMatchupServer(f);
      addPrediction({
        fixture_id: matchKey || String(f.id),
        predicted_outcome: (sim.result.homeScore > sim.result.awayScore ? "1" : sim.result.homeScore < sim.result.awayScore ? "2" : "X") as any,
        predicted_home_score: sim.result.homeScore,
        predicted_away_score: sim.result.awayScore,
        predicted_home_xg: sim.result.homeExpectedGoals,
        predicted_away_xg: sim.result.awayExpectedGoals,
        confidence: sim.result.confidencePercentage,
        coefficients_snapshot: { home: sim.homeCoefficients, away: sim.awayCoefficients },
        model_version: "rule-engine-v1",
        source: f.source || "model-engine"
      });
      added++;
    }
  }
  if (added > 0) console.log(`[PREDICTION ENGINE] Generated and froze ${added} pre-match predictions before kickoff.`);
}

// Server-side hardened merge engine
function sourcePriority(source: string | undefined): number {
  switch (source) {
    case "sportapi-ai": return 100;
    case "therundown":
    case "custom-results-api": return 90;
    case "bookmaker-import":
    case "hollywoodbets-pdf":
    case "manual-ingest": return 80;
    case "espn": return 30;
    default: return 10;
  }
}

function mergeServerSlates(existing: any[], incoming: any[], isIncomingBookmaker = false): any[] {
  const map = new Map<string, any>();
  const put = (item: any, incomingItem: boolean) => {
    if (!item?.homeTeam || !item?.awayTeam || !item?.date) return;
    const key = getCompositeKeyServer(item.homeTeam, item.awayTeam, item.date);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        ...item,
        sourceConfidence: item.sourceConfidence || (sourcePriority(item.source) >= 80 ? "verified" : "unknown"),
        ingestedAt: item.ingestedAt || new Date().toISOString(),
        isBookmakerProtected: isIncomingBookmaker || item.source === "bookmaker-import" || item.source === "hollywoodbets-pdf" || item.isBookmakerProtected || false
      });
      return;
    }
    const protectedBookmaker = prev.isBookmakerProtected || prev.source === "bookmaker-import" || prev.source === "hollywoodbets-pdf";
    if (protectedBookmaker && !isIncomingBookmaker && item.source !== "custom-results-api") {
      map.set(key, {
        ...prev,
        competition: prev.competition || item.competition,
        status: item.status && item.status !== "NS" ? item.status : prev.status,
        finalScore: item.finalScore || prev.finalScore,
        resultSettled: item.resultSettled ?? prev.resultSettled,
        settledAt: item.settledAt || prev.settledAt,
        resultSource: item.resultSource || prev.resultSource,
        sourceConfidence: prev.sourceConfidence === "verified" ? "verified" : (item.sourceConfidence || prev.sourceConfidence)
      });
      return;
    }
    const prevPriority = sourcePriority(prev.source);
    const nextPriority = sourcePriority(item.source);
    const nextIsNewer = !prev.ingestedAt || !item.ingestedAt || new Date(item.ingestedAt).getTime() >= new Date(prev.ingestedAt).getTime();
    const useIncoming = incomingItem && (nextPriority > prevPriority || (nextPriority === prevPriority && nextIsNewer));
    const base = useIncoming ? prev : item;
    const overlay = useIncoming ? item : prev;
    map.set(key, {
      ...base,
      ...Object.fromEntries(Object.entries(overlay).filter(([k,v]) => v !== undefined && v !== null)),
      source: useIncoming ? item.source : prev.source,
      sourceConfidence: useIncoming ? (item.sourceConfidence || prev.sourceConfidence) : prev.sourceConfidence,
      ingestedAt: useIncoming ? (item.ingestedAt || prev.ingestedAt) : prev.ingestedAt,
      isBookmakerProtected: isIncomingBookmaker || item.source === "bookmaker-import" || item.source === "hollywoodbets-pdf" || prev.isBookmakerProtected || false
    });
  };
  for (const item of existing) put(item, false);
  for (const item of incoming) put(item, true);
  return Array.from(map.values()).sort((a,b) => a.date === b.date ? (a.time || "99:99").localeCompare(b.time || "99:99") : a.date.localeCompare(b.date));
}

// Lazy init Gemini SDK
let ai: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not configured. Please add it in the Secrets panel.");
    }
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return ai;
}

// 1. API: Digest pasted text/HTML stats payload
app.post("/api/digest", async (req, res) => {
  try {
    const { payload } = req.body;
    if (!payload || typeof payload !== "string" || payload.trim() === "") {
      return res.status(400).json({ error: "Payload content is required" });
    }

    const client = getGeminiClient();

    // We pass the 80 target teams to Gemini to help map them accurately even with abbreviations
    const systemPrompt = `You are a bias-free football statistics parser.
Your task is to ingest a scraped sports payload (HTML or text) and extract match details, physical pitch facts, expected goals (xG), possession, and team circumstances.

Strict constraints:
1. Identify any match containing at least one of our 80 Target Favourite Teams:
${LOCKED_80_TEAMS.join(", ")}

2. Match variations of team names in the payload to our exact target name if possible (e.g. "Napoli" maps to "Napoli", "Inter W" or "Inter Milan Women" maps to "Inter Milan Women", etc.).

3. Extract:
- Home Team name and Away Team name
- Home score and Away score
- Home expected goals (xG) and Away expected goals (xG)
- Home possession (%) and Away possession (%)
- Pitch facts (e.g., cards, red cards, injuries, style of low-block defense, shots on target)
- Competition name
- If it is a local derby (true/false)
- If either team played a major fixture within 3-4 days (contextual fatigue)

Discard any match where neither team matches any of our 80 Favourite Teams.`;

    const userPrompt = `Please parse the following sports payload and output a JSON array of parsed matches that include at least one of the 80 target teams.

Payload:
${payload}
`;

    const response = await client.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: userPrompt }] }
      ],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          description: "List of matched parsed fixtures",
          items: {
            type: Type.OBJECT,
            properties: {
              homeTeam: { type: Type.STRING, description: "Mapped exact name of Home team" },
              awayTeam: { type: Type.STRING, description: "Mapped exact name of Away team" },
              homeGoals: { type: Type.INTEGER },
              awayGoals: { type: Type.INTEGER },
              homeXG: { type: Type.NUMBER, description: "Expected goals (xG) for home team" },
              awayXG: { type: Type.NUMBER, description: "Expected goals (xG) for away team" },
              homePossession: { type: Type.INTEGER },
              awayPossession: { type: Type.INTEGER },
              pitchFacts: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }, 
                description: "Key physical facts like red cards, block layout, tactical patterns" 
              },
              wasDerby: { type: Type.BOOLEAN },
              competition: { type: Type.STRING },
              hasContinentalFatigueHome: { type: Type.BOOLEAN, description: "Home team played high-intensity match in 3-4 days" },
              hasContinentalFatigueAway: { type: Type.BOOLEAN, description: "Away team played high-intensity match in 3-4 days" }
            },
            required: ["homeTeam", "awayTeam", "homeGoals", "awayGoals", "homeXG", "awayXG", "homePossession", "awayPossession"]
          }
        }
      }
    });

    const parsedData = JSON.parse(response.text || "[]");
    return res.json({ matches: parsedData });
  } catch (err: any) {
    console.error("Error in /api/digest:", err);
    return res.status(500).json({ error: err.message || "Failed to digest payload via Gemini" });
  }
});

// No hardcoded fixture slate is considered real-world evidence.
// No hardcoded match slate is treated as real-world evidence.
const STATIC_REAL_WORLD_FIXTURES: Record<string, any[]> = {};

// Live, dynamic, zero-quota ESPN web scraper
async function fetchEspnFixtures(dateString: string): Promise<any[]> {
  try {
    const yyyymmdd = dateString.replace(/-/g, "");
    const url = `https://www.espn.com/soccer/fixtures/_/date/${yyyymmdd}`;
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      }
    });
    
    if (!response.ok) {
      return [];
    }
    
    const html = await response.text();
    const fixtures: any[] = [];
    
    // Attempt 1: Parse the structured JSON payload embedded inside ESPN's pre-rendered window.__initialData__ script
    const jsonMatch = html.match(/window\.__initialData__\s*=\s*({.+?});/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        if (data.leagues && Array.isArray(data.leagues)) {
          for (const league of data.leagues) {
            const leagueName = league.name || "League Match";
            if (league.events && Array.isArray(league.events)) {
              for (const event of league.events) {
                const gameId = event.id || Math.random().toString(36).substring(7);
                const time = event.time || "15:00";
                
                // Extract teams
                const homeTeamName = event.homeTeam?.name || "";
                const awayTeamName = event.awayTeam?.name || "";
                
                if (!homeTeamName || !awayTeamName) continue;
                
                // Match against our locked 80 target teams
                const isHomeFav = LOCKED_80_TEAMS.some(t => t.toLowerCase() === homeTeamName.toLowerCase());
                const isAwayFav = LOCKED_80_TEAMS.some(t => t.toLowerCase() === awayTeamName.toLowerCase());
                
                if (isHomeFav || isAwayFav) {
                  const matchedHome = LOCKED_80_TEAMS.find(t => t.toLowerCase() === homeTeamName.toLowerCase()) || homeTeamName;
                  const matchedAway = LOCKED_80_TEAMS.find(t => t.toLowerCase() === awayTeamName.toLowerCase()) || awayTeamName;
                  
                  fixtures.push({
                    id: `espn-${gameId}`,
                    date: dateString,
                    time,
                    homeTeam: matchedHome,
                    awayTeam: matchedAway,
                    competition: leagueName,
                    source: "espn",
                    sourceConfidence: "unknown",
                    ingestedAt: new Date().toISOString()
                  });
                }
              }
            }
          }
        }
      } catch (jsonErr) {
        // Fall back silently to regex if JSON parsing fails
      }
    }
    
    if (fixtures.length > 0) return fixtures;

    // Attempt 2: Resilient HTML regex crawler for Team Anchor Tags in ESPN match blocks
    const teamRegex = /\/soccer\/team\/_\/id\/\d+\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;
    const extractedTeams: { slug: string; name: string }[] = [];
    while ((match = teamRegex.exec(html)) !== null) {
      extractedTeams.push({ slug: match[1], name: match[2].trim() });
    }
    
    // Group adjacent teams into match cards
    for (let i = 0; i < extractedTeams.length; i += 2) {
      if (i + 1 < extractedTeams.length) {
        const home = extractedTeams[i].name;
        const away = extractedTeams[i + 1].name;
        
        const isHomeFav = LOCKED_80_TEAMS.some(t => t.toLowerCase() === home.toLowerCase());
        const isAwayFav = LOCKED_80_TEAMS.some(t => t.toLowerCase() === away.toLowerCase());
        
        if (isHomeFav || isAwayFav) {
          const matchedHome = LOCKED_80_TEAMS.find(t => t.toLowerCase() === home.toLowerCase()) || home;
          const matchedAway = LOCKED_80_TEAMS.find(t => t.toLowerCase() === away.toLowerCase()) || away;
          
          fixtures.push({
            id: `espn-regex-${i}-${dateString}`,
            date: dateString,
            time: "17:00",
            homeTeam: matchedHome,
            awayTeam: matchedAway,
            competition: "League Match",
            source: "espn",
            sourceConfidence: "unknown",
            ingestedAt: new Date().toISOString()
          });
        }
      }
    }
    
    return fixtures;
  } catch (error) {
    return [];
  }
}

// ==========================================
// FIXTURES PERSISTENCE & HARDENED MERGE APIS
// ==========================================

// Endpoint to ingest raw bookmaker slates or updated fixtures directly to server disk
app.post(["/api/fixtures/ingest-slate", "/api/fixtures/save-disk"], (req, res) => {
  try {
    const { fixtures, source = "bookmaker-import" } = req.body;
    if (!fixtures || !Array.isArray(fixtures)) {
      return res.status(400).json({ error: "fixtures array is required" });
    }

    const currentManifest = loadPersistedFixturesFromDisk();
    const isBookmaker = source === "bookmaker-import";
    const updatedManifest = mergeServerSlates(currentManifest, fixtures, isBookmaker);

    // Write directly to server filesystem disk
    saveFixturesToDisk(updatedManifest);

    // Warm up and update in-memory daily cache for every date in the incoming payload
    const datesTouched = new Set<string>();
    for (const f of fixtures) {
      if (f.date) datesTouched.add(f.date);
    }
    for (const d of datesTouched) {
      const matchesOnDate = updatedManifest.filter((m: any) => m.date === d);
      dailyFixtureCache[d] = { fixtures: matchesOnDate, timestamp: Date.now() };
    }

    return res.json({
      success: true,
      message: `Successfully persisted ${fixtures.length} matches directly to server disk manifest.`,
      savedCount: fixtures.length,
      totalPersisted: updatedManifest.length,
      manifest: updatedManifest
    });
  } catch (err: any) {
    console.error("Error in /api/fixtures/ingest-slate:", err);
    return res.status(500).json({ error: err.message || "Failed to persist slate to disk" });
  }
});

// Endpoint to upload and extract fixtures from Hollywoodbets PDF files
app.post("/api/fixtures/upload-pdf", async (req, res) => {
  try {
    let pdfBuffer: Buffer | null = null;
    const defaultDate = req.body?.defaultDate || getTodayDateStrServer();

    if (req.body?.pdfBase64) {
      const cleanBase64 = req.body.pdfBase64.replace(/^data:application\/pdf;base64,/, "");
      pdfBuffer = Buffer.from(cleanBase64, "base64");
    } else if (Buffer.isBuffer(req.body)) {
      pdfBuffer = req.body;
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      return res.status(400).json({ error: "PDF data missing. Send JSON with pdfBase64 or binary buffer." });
    }

    const { text: extractedText, totalPages } = await extractTextFromPdfBuffer(pdfBuffer);

    const parseResult = parseBookmakerRawText(extractedText, defaultDate);

    if (parseResult.matches.length > 0) {
      const incomingFixtures = parseResult.matches.map(m => m.fixture);
      const currentManifest = loadPersistedFixturesFromDisk();
      const updatedManifest = mergeServerSlates(currentManifest, incomingFixtures, true);
      
      saveFixturesToDisk(updatedManifest);

      for (const k of Object.keys(dailyFixtureCache)) {
        dailyFixtureCache[k].fixtures = mergeServerSlates(dailyFixtureCache[k].fixtures, incomingFixtures, true);
      }

      return res.json({
        success: true,
        message: `Parsed ${parseResult.matches.length} fixtures directly from Hollywoodbets PDF!`,
        totalExtracted: parseResult.matches.length,
        totalPages: totalPages,
        matches: parseResult.matches,
        fixtures: incomingFixtures,
        manifestCount: updatedManifest.length
      });
    } else {
      return res.json({
        success: false,
        message: "No valid Hollywoodbets fixture rows detected in PDF.",
        totalExtracted: 0,
        totalPages: totalPages,
        textLength: extractedText.length,
        extractedSample: extractedText.substring(0, 400)
      });
    }
  } catch (err: any) {
    console.error("Error in /api/fixtures/upload-pdf:", err);
    return res.status(500).json({ error: err.message || "Failed to parse PDF document" });
  }
});

// Endpoint to purge all stored fixtures completely (Clean reset)
app.post("/api/fixtures/purge", (req, res) => {
  try {
    saveFixturesToDisk([]);
    for (const k of Object.keys(dailyFixtureCache)) {
      delete dailyFixtureCache[k];
    }
    return res.json({ success: true, message: "Successfully purged all stored fixtures from server disk", fixtures: [] });
  } catch (err: any) {
    console.error("Error in /api/fixtures/purge:", err);
    return res.status(500).json({ error: err.message || "Failed to purge fixtures" });
  }
});

// Endpoint to delete a specific match by ID or composite key
app.post("/api/fixtures/delete", (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Match id is required" });

    const currentManifest = loadPersistedFixturesFromDisk();
    const updated = currentManifest.filter((m: any) => m.id !== id);
    saveFixturesToDisk(updated);

    for (const k of Object.keys(dailyFixtureCache)) {
      dailyFixtureCache[k].fixtures = dailyFixtureCache[k].fixtures.filter((m: any) => m.id !== id);
    }

    return res.json({ success: true, manifest: updated });
  } catch (err: any) {
    console.error("Error in /api/fixtures/delete:", err);
    return res.status(500).json({ error: err.message || "Failed to delete fixture" });
  }
});

// Endpoint to retrieve all disk-persisted fixtures across all dates
app.get("/api/fixtures/persisted", (req, res) => {
  try {
    const manifest = loadPersistedFixturesFromDisk();
    return res.json({ fixtures: manifest, count: manifest.length });
  } catch (err: any) {
    console.error("Error in /api/fixtures/persisted:", err);
    return res.status(500).json({ error: "Failed to retrieve persisted fixtures" });
  }
});

// ==========================================
// AUTOMATED RESULTS SCANNER & CUSTOM RESULTS API ENGINE (WITH STRICT QUOTA PROTECTION)
// ==========================================

const RESULTS_CONFIG_FILE = path.join(DATA_DIR, "results-config.json");

let resultsApiConfig = {
  apiUrl: "",
  autoScanEnabled: true,
  maxCallsPerDay: 10,            // Strict limit for this app (out of 100 total user quota)
  todayCallsCount: 0,             // Number of API calls made today
  callsResetDateStr: "",          // YYYY-MM-DD string for midnight reset
  scanIntervalHours: 4,           // Run scan every 4 hours by default (max 6 calls/day)
  onlyScanDuringMatches: true,    // Skip API calls if no pending matches are playing or completed
  cacheTtlMinutes: 120,           // Re-use fetched scores for 2 hours before calling API again
  lastCachedResponse: null as any,
  lastCachedTimestamp: 0,
  lastScanTimestamp: 0,
  lastScanStatus: "Idle",
  lastScanSettledCount: 0
};

function loadResultsConfig() {
  ensureDataDir();
  try {
    if (fs.existsSync(RESULTS_CONFIG_FILE)) {
      const data = fs.readFileSync(RESULTS_CONFIG_FILE, "utf-8");
      resultsApiConfig = { ...resultsApiConfig, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error("Error loading results-config.json:", e);
  }
}

function saveResultsConfig() {
  ensureDataDir();
  try {
    fs.writeFileSync(RESULTS_CONFIG_FILE, JSON.stringify(resultsApiConfig, null, 2), "utf-8");
  } catch (e) {
    console.error("Error saving results-config.json:", e);
  }
}

loadResultsConfig();

function checkAndResetResultsApiQuota(): boolean {
  const todayStr = new Date().toISOString().split("T")[0];
  if (resultsApiConfig.callsResetDateStr !== todayStr) {
    resultsApiConfig.callsResetDateStr = todayStr;
    resultsApiConfig.todayCallsCount = 0;
    saveResultsConfig();
  }
  return resultsApiConfig.todayCallsCount < resultsApiConfig.maxCallsPerDay;
}

// Get / update Custom Results API settings
app.get("/api/results/config", (req, res) => {
  checkAndResetResultsApiQuota();
  return res.json({ ...resultsApiConfig, apiKeyConfigured: Boolean(process.env.API_FOOTBALL_KEY) });
});

app.post("/api/results/config", (req, res) => {
  try {
    const { apiUrl, autoScanEnabled, maxCallsPerDay, scanIntervalHours, onlyScanDuringMatches, cacheTtlMinutes } = req.body;
    if (apiUrl !== undefined) resultsApiConfig.apiUrl = String(apiUrl).trim();
    if (autoScanEnabled !== undefined) resultsApiConfig.autoScanEnabled = Boolean(autoScanEnabled);
    if (maxCallsPerDay !== undefined) resultsApiConfig.maxCallsPerDay = Math.max(1, Math.min(100, Number(maxCallsPerDay)));
    if (scanIntervalHours !== undefined) resultsApiConfig.scanIntervalHours = Math.max(1, Number(scanIntervalHours));
    if (onlyScanDuringMatches !== undefined) resultsApiConfig.onlyScanDuringMatches = Boolean(onlyScanDuringMatches);
    if (cacheTtlMinutes !== undefined) resultsApiConfig.cacheTtlMinutes = Math.max(5, Number(cacheTtlMinutes));

    saveResultsConfig();
    return res.json({ success: true, config: { ...resultsApiConfig, apiKeyConfigured: Boolean(process.env.API_FOOTBALL_KEY) } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Webhook / Direct endpoint to push match final scores from custom API
app.post("/api/results/push-scores", (req, res) => {
  const configuredSecret = process.env.RESULTS_WEBHOOK_SECRET;
  const providedSecret = req.header("x-results-webhook-secret");
  if (!configuredSecret || !providedSecret || providedSecret !== configuredSecret) {
    return res.status(401).json({ error: "Authorized results webhook secret required." });
  }
  try {
    const { scores } = req.body; // Array of { homeTeam, awayTeam, date, homeGoals, awayGoals, status }
    if (!scores || !Array.isArray(scores)) {
      return res.status(400).json({ error: "scores array is required" });
    }

    const currentManifest = loadPersistedFixturesFromDisk();
    let updatedCount = 0;

    const updatedManifest = currentManifest.map((match: any) => {
      const matchKey = getCompositeKeyServer(match.homeTeam, match.awayTeam, match.date);
      const matchedScore = scores.find((s: any) => {
        const scoreKey = getCompositeKeyServer(s.homeTeam, s.awayTeam, s.date || match.date);
        return scoreKey === matchKey;
      });

      if (matchedScore) {
        updatedCount++;
        return {
          ...match,
          status: matchedScore.status || "FT",
          finalScore: {
            home: Number(matchedScore.homeGoals ?? matchedScore.homeScore ?? 0),
            away: Number(matchedScore.awayGoals ?? matchedScore.awayScore ?? 0)
          },
          resultSettled: true,
          settledAt: new Date().toISOString(),
          resultSource: matchedScore.source || "custom-results-api"
        };
      }
      return match;
    });

    saveFixturesToDisk(updatedManifest);

    for (const k of Object.keys(dailyFixtureCache)) {
      dailyFixtureCache[k].fixtures = loadPersistedFixturesFromDisk().filter((f: any) => f.date === k);
    }

    return res.json({
      success: true,
      message: `Successfully settled ${updatedCount} match results from custom API push`,
      settledCount: updatedCount,
      manifest: updatedManifest
    });
  } catch (err: any) {
    console.error("Error in /api/results/push-scores:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Primary automated results scanning function
async function runAutomaticResultsScan(): Promise<{ settledCount: number; message: string }> {
  resultsApiConfig.lastScanTimestamp = Date.now();
  resultsApiConfig.lastScanStatus = "Scanning...";

  const currentManifest = loadPersistedFixturesFromDisk();
  const unsettled = currentManifest.filter((m: any) => !m.resultSettled || m.status !== "FT");

  if (unsettled.length === 0) {
    resultsApiConfig.lastScanStatus = "All fixtures already settled";
    saveResultsConfig();
    return { settledCount: 0, message: "No unsettled fixtures pending score verification." };
  }

  let totalSettled = 0;
  const updatedManifest = [...currentManifest];

  // 1. Try fetching scores from Custom Results API URL if configured with Quota Protection
  if (resultsApiConfig.apiUrl) {
    const isWithinQuota = checkAndResetResultsApiQuota();
    const cacheAgeMs = Date.now() - (resultsApiConfig.lastCachedTimestamp || 0);
    const isCacheValid = resultsApiConfig.lastCachedResponse && cacheAgeMs < (resultsApiConfig.cacheTtlMinutes * 60 * 1000);

    let scoreArray: any[] = [];
    let usedCache = false;

    if (isCacheValid) {
      console.log(`[QUOTA GUARD] Using valid cached API results (${Math.round(cacheAgeMs / 60000)}m old). 0 API calls consumed.`);
      scoreArray = Array.isArray(resultsApiConfig.lastCachedResponse) 
        ? resultsApiConfig.lastCachedResponse 
        : (resultsApiConfig.lastCachedResponse.results || resultsApiConfig.lastCachedResponse.scores || []);
      usedCache = true;
    } else if (!isWithinQuota) {
      console.warn(`[QUOTA GUARD] Daily API call quota limit reached (${resultsApiConfig.todayCallsCount}/${resultsApiConfig.maxCallsPerDay} calls today). Skipping outgoing API request.`);
      resultsApiConfig.lastScanStatus = `Quota limit reached (${resultsApiConfig.todayCallsCount}/${resultsApiConfig.maxCallsPerDay} calls today). Skipping API call to preserve quota.`;
      saveResultsConfig();
    } else {
      // Check if there are active or past unsettled matches
      const todayStr = new Date().toISOString().split("T")[0];
      const hasActiveOrPastMatches = unsettled.some((m: any) => m.date <= todayStr);

      if (resultsApiConfig.onlyScanDuringMatches && !hasActiveOrPastMatches) {
        console.log("[QUOTA GUARD] Skipping API request: All pending matches are in the future.");
      } else {
        try {
          const todayStr = new Date().toISOString().split("T")[0];
          const fetchUrl = `${resultsApiConfig.apiUrl}?date=${todayStr}`;
          const apiKey = process.env.API_FOOTBALL_KEY || "";
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "x-apisports-key": apiKey
          };

          const res = await fetch(fetchUrl, { headers });
          if (res.ok) {
            const data = await res.json();
            resultsApiConfig.todayCallsCount++;
            resultsApiConfig.lastCachedTimestamp = Date.now();
            resultsApiConfig.lastCachedResponse = data;
            saveResultsConfig();

            const items = data.response || data.results || data.scores || data.fixtures || (Array.isArray(data) ? data : []);
            scoreArray = items.map((item: any) => {
              if (item.fixture && item.teams && item.goals) {
                return {
                  homeTeam: item.teams.home.name,
                  awayTeam: item.teams.away.name,
                  status: item.fixture.status.short,
                  homeGoals: item.goals.home,
                  awayGoals: item.goals.away,
                  date: todayStr
                };
              }
              return item;
            });
            console.log(`[API-FOOTBALL] Fetch succeeded. Settling scores for ${scoreArray.length} fixtures.`);
          }
        } catch (apiErr: any) {
          console.warn("API-Football fetch warning:", apiErr.message);
        }
      }
    }

    if (scoreArray.length > 0) {
      for (let i = 0; i < updatedManifest.length; i++) {
        const match = updatedManifest[i];
        if (match.resultSettled && match.status === "FT") continue;

        const matchKey = getCompositeKeyServer(match.homeTeam, match.awayTeam, match.date);
        const found = scoreArray.find((s: any) => {
          const key = getCompositeKeyServer(s.homeTeam || s.home_team, s.awayTeam || s.away_team, s.date || match.date);
          return key === matchKey;
        });

        if (found && (found.status === "FT" || found.status === "FINISHED" || found.homeGoals !== undefined || found.home_score !== undefined)) {
          const hG = Number(found.homeGoals ?? found.home_score ?? found.homeScore ?? 0);
          const aG = Number(found.awayGoals ?? found.away_score ?? found.awayScore ?? 0);
          
          updatedManifest[i] = {
            ...match,
            status: "FT",
            finalScore: { home: hG, away: aG },
            resultSettled: true,
            settledAt: new Date().toISOString(),
            resultSource: usedCache ? "custom-results-api (cached)" : "custom-results-api"
          };
          totalSettled++;
        }
      }
    }
  }

  // 2. Verify remaining past fixtures against trusted score providers only.
  const stillUnsettled = updatedManifest.filter((m: any) => !m.resultSettled || m.status !== "FT");
  const datesToVerify = [...new Set(stillUnsettled.filter(m => m.date <= new Date().toISOString().split("T")[0]).map(m => m.date))];
  for (const date of datesToVerify) {
    const providerResults = [
      ...(await fetchSportApiAiFixtures(date)),
      ...(await fetchTheRundownFixtures(date))
    ];
    for (let i = 0; i < updatedManifest.length; i++) {
      const match = updatedManifest[i];
      if (match.resultSettled && match.status === "FT") continue;
      const found = providerResults.find((r: any) =>
        getCompositeKeyServer(r.homeTeam, r.awayTeam, r.date) === getCompositeKeyServer(match.homeTeam, match.awayTeam, match.date) &&
        (r.resultSettled === true || r.status === "FT")
      );
      if (found && found.homeGoals !== undefined && found.awayGoals !== undefined) {
        updatedManifest[i] = {
          ...match,
          status: "FT",
          finalScore: { home: Number(found.homeGoals), away: Number(found.awayGoals) },
          resultSettled: true,
          settledAt: new Date().toISOString(),
          resultSource: found.source || "trusted-provider"
        };
        totalSettled++;
      }
    }
  }

  saveFixturesToDisk(updatedManifest);
  resultsApiConfig.lastScanSettledCount = totalSettled;
  resultsApiConfig.lastScanStatus = `Scan completed. Settled ${totalSettled} results.`;
  saveResultsConfig();

  recordSettledMatchHistoryServer(updatedManifest);

  return {
    settledCount: totalSettled,
    message: `Scan finished. Verified and settled ${totalSettled} match results!`
  };
}

// Helper to record settled match predictions, results, and coefficient updates via server-db.ts
function recordSettledMatchHistoryServer(manifest: any[]) {
  const predictions = getPredictions();
  const resultsFile = path.join(DATA_DIR, "db_results.json");
  let resultsList: any[] = [];
  if (fs.existsSync(resultsFile)) {
    try { resultsList = JSON.parse(fs.readFileSync(resultsFile, "utf-8")); } catch(e){}
  }

  let modified = false;

  for (const match of manifest) {
    if (match.resultSettled && match.status === "FT" && match.finalScore) {
      const matchKey = getCompositeKeyServer(match.homeTeam, match.awayTeam, match.date);
      
      // Look up pre-existing prediction stored before kickoff
      const pred = predictions.find(p => p.fixture_id === matchKey || p.fixture_id === String(match.id));
      
      let resItem = resultsList.find((r: any) => r.matchKey === matchKey);
      if (!resItem) {
        const actualOutcome = match.finalScore.home > match.finalScore.away ? "1" : match.finalScore.home < match.finalScore.away ? "2" : "X";
        const isCorrect = pred ? pred.predicted_outcome === actualOutcome : false;

        resItem = {
          id: `res-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          matchKey,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          date: match.date,
          competition: match.competition || "League",
          hasPriorPrediction: !!pred,
          predictedOutcome: pred ? pred.predicted_outcome : "N/A (Ungraded)",
          actualOutcome,
          predictedScore: pred ? `${pred.predicted_home_score}-${pred.predicted_away_score}` : "N/A",
          actualScore: `${match.finalScore.home}-${match.finalScore.away}`,
          isCorrect: pred ? isCorrect : null,
          source: match.resultSource || match.source || "api-football",
          verifiedAt: match.settledAt || new Date().toISOString()
        };
        resultsList.push(resItem);
        modified = true;

        if (pred && pred.predicted_home_xg !== undefined && pred.predicted_away_xg !== undefined) {
          applyCalibrationServer(
            match.homeTeam,
            match.awayTeam,
            match.finalScore.home,
            match.finalScore.away,
            pred.predicted_home_xg,
            pred.predicted_away_xg,
            match.wasDerby || false,
            String(match.id || matchKey),
            match.resultSource || "trusted-provider"
          );
        }
      }
    }
  }

  if (modified) {
    ensureDataDir();
    fs.writeFileSync(resultsFile, JSON.stringify(resultsList, null, 2), "utf-8");
  }
}

// API Endpoints for history & matrices
app.get("/api/predictions/history", (req, res) => {
  return res.json({ predictions: getPredictions() });
});

app.get("/api/results/verified", (req, res) => {
  const resultsFile = path.join(DATA_DIR, "db_results.json");
  if (fs.existsSync(resultsFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(resultsFile, "utf-8"));
      return res.json({ results: data });
    } catch(e) {}
  }
  return res.json({ results: [] });
});

app.get("/api/coefficients/history", (req, res) => {
  const team = (req.query.team as string) || "Napoli";
  const history = getCoefficientHistory();
  const filtered = history.filter(h => !team || h.team.toLowerCase() === team.toLowerCase() || h.team === "Napoli");
  return res.json({ history: filtered.length > 0 ? filtered : history });
});

app.get("/api/matrices", (req, res) => {
  return res.json({ matrices: getMatrices() });
});
app.post("/api/matrices", (req, res) => {
  try {
    const incoming = req.body?.matrices;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({ error: "matrices object is required" });
    }
    const current = getMatrices();
    const next: Record<string, any> = { ...current };
    for (const [team, value] of Object.entries(incoming as Record<string, any>)) {
      if (!current[team] || !value?.learned_coefficients) continue;
      const c = value.learned_coefficients;
      const nums = [c.home_advantage_multiplier, c.form_momentum_weight, c.volatility_index, c.fatigue_penalty_modifier];
      if (nums.some((n: any) => typeof n !== "number" || !Number.isFinite(n)) || nums.some((n: number) => n < 0.5 || n > 1.5)) continue;
      next[team] = { ...current[team], learned_coefficients: {
        home_advantage_multiplier: c.home_advantage_multiplier,
        form_momentum_weight: c.form_momentum_weight,
        volatility_index: c.volatility_index,
        fatigue_penalty_modifier: c.fatigue_penalty_modifier
      }};
    }
    saveMatrices(next);
    return res.json({ success: true, matrices: next });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to save matrices" });
  }
});


// Endpoint to trigger automated results scan on demand
app.post("/api/results/scan", async (req, res) => {
  try {
    const outcome = await runAutomaticResultsScan();
    const manifest = loadPersistedFixturesFromDisk();
    return res.json({
      success: true,
      ...outcome,
      fixtures: manifest,
      config: resultsApiConfig
    });
  } catch (err: any) {
    console.error("Error in /api/results/scan:", err);
    return res.status(500).json({ error: err.message || "Failed to scan results" });
  }
});

// Automatic background results scanner loop (runs based on user's scanIntervalHours setting, default 4 hours)
setInterval(() => {
  if (resultsApiConfig.autoScanEnabled) {
    runAutomaticResultsScan().catch(err => console.error("Background results scan error:", err));
  }
}, Math.max(1, resultsApiConfig.scanIntervalHours || 4) * 60 * 60 * 1000);

// Dynamic failsafe backup fixture generator to handle API quota exhaustion/rate limits (429) gracefully
function generateFailsafeFixtures(dateString: string): any[] {
  const manifest = loadPersistedFixturesFromDisk();
  const diskMatches = manifest.filter((f: any) => f.date === dateString);
  if (diskMatches.length > 0) {
    return diskMatches;
  }
  if (STATIC_REAL_WORLD_FIXTURES[dateString]) {
    return STATIC_REAL_WORLD_FIXTURES[dateString];
  }
  return [];
}

// In-memory cache for daily fixtures with timestamp to enforce rate-budgeting and respect 100 calls/day limit
const dailyFixtureCache: Record<string, { fixtures: any[]; timestamp: number }> = {};
let dailyApiCallCount = 0;
let lastResetTimestamp = Date.now();

function checkAndIncrementQuota(): boolean {
  const now = Date.now();
  // Reset daily count every 24 hours
  if (now - lastResetTimestamp > 24 * 60 * 60 * 1000) {
    dailyApiCallCount = 0;
    lastResetTimestamp = now;
  }
  // Cap at 30 Gemini Search calls per day out of 100 total quota to leave room for other apps and research
  if (dailyApiCallCount >= 30) {
    return false;
  }
  dailyApiCallCount++;
  return true;
}

// 3. API: Dynamic Fixtures Fetcher with SportAPI.ai (Primary) & TheRundown (Secondary) Priority
app.get("/api/real-fixtures", async (req, res) => {
  const targetDate = (req.query.date as string) || getTodayDateStrServer();
  try {
    const manifest = loadPersistedFixturesFromDisk();
    const diskMatches = manifest.filter((f: any) => f.date === targetDate);
    const cachedEntry = dailyFixtureCache[targetDate];
    const today = getTodayDateStrServer();
    const cacheDuration = targetDate <= today ? 30 * 60 * 1000 : 6 * 60 * 60 * 1000;

    if (cachedEntry && Date.now() - cachedEntry.timestamp < cacheDuration) {
      const merged = mergeServerSlates(diskMatches, cachedEntry.fixtures);
      return res.json({ fixtures: merged, source: "cache", stale: false, fetchedAt: new Date(cachedEntry.timestamp).toISOString() });
    }

    const providerResults: any[] = [];
    const sources: string[] = [];
    const sportApiFixtures = await fetchSportApiAiFixtures(targetDate);
    if (sportApiFixtures.length) { providerResults.push(...sportApiFixtures); sources.push("sportapi-ai"); }
    const rundownFixtures = await fetchTheRundownFixtures(targetDate);
    if (rundownFixtures.length) { providerResults.push(...rundownFixtures); sources.push("therundown"); }

    let merged = mergeServerSlates(diskMatches, providerResults);
    let source = sources.length ? sources.join("+") : "disk-manifest";

    if (merged.length === 0) {
      const espnFixtures = (await fetchEspnFixtures(targetDate)).map((f: any) => ({
        ...f, source: "espn", sourceConfidence: "unknown", ingestedAt: new Date().toISOString()
      }));
      merged = mergeServerSlates(diskMatches, espnFixtures);
      source = espnFixtures.length ? "espn-discovery" : "none";
    }

    if (providerResults.length) {
      saveFixturesToDisk(mergeServerSlates(manifest, providerResults));
      generatePreMatchPredictions(merged.filter((f: any) => f.sourceConfidence === "verified"));
    }

    dailyFixtureCache[targetDate] = { fixtures: merged, timestamp: Date.now() };
    return res.json({ fixtures: merged, source, stale: providerResults.length === 0, fetchedAt: new Date().toISOString() });
  } catch (err: any) {
    const backup = loadPersistedFixturesFromDisk().filter((f: any) => f.date === targetDate);
    return res.json({ fixtures: backup, source: "disk-fallback", stale: true, error: "Fresh fixture providers were unavailable; disk data may be stale." });
  }
});

// Cron Status & Background Scheduler
let lastIngestDateStr = "";
let cronStatusInfo = {
  lastIngestTime: null as string | null,
  lastIngestStatus: "Idle",
  lastSettlementTime: null as string | null,
  lastSettlementStatus: "Idle",
  primaryProvider: "sportapi-ai",
  secondaryProvider: "therundown"
};

async function runScheduledIngestAndSettlement() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const todayStr = now.toISOString().split("T")[0];

  // Daily ingest cron at 05:30 UTC
  if ((utcHour === 5 && utcMinute >= 30 && lastIngestDateStr !== todayStr) || (!lastIngestDateStr && utcHour >= 5)) {
    lastIngestDateStr = todayStr;
    console.log(`[CRON] Running daily automated fixture ingestion for ${todayStr}...`);
    try {
      let fixtures = await fetchSportApiAiFixtures(todayStr);
      let sourceUsed = "sportapi-ai";
      if (!fixtures || fixtures.length === 0) {
        fixtures = await fetchTheRundownFixtures(todayStr);
        sourceUsed = "therundown";
      }
      if (fixtures && fixtures.length > 0) {
        const manifest = loadPersistedFixturesFromDisk();
        const merged = mergeServerSlates(manifest, fixtures);
        saveFixturesToDisk(merged);
        cronStatusInfo.lastIngestTime = new Date().toISOString();
        cronStatusInfo.lastIngestStatus = `Success: Ingested ${fixtures.length} fixtures from ${sourceUsed}`;
      } else {
        cronStatusInfo.lastIngestStatus = "No fixtures returned from primary or secondary provider";
      }
    } catch (err: any) {
      console.error("[CRON] Daily ingestion error:", err.message);
      cronStatusInfo.lastIngestStatus = `Error: ${err.message}`;
    }
  }

  // Settlement cron every 3 hours at minute 15
  if (utcMinute >= 15 && utcMinute < 20) {
    const settlementKey = `${todayStr}-${utcHour}`;
    if ((global as any).__lastSettlementHourKey !== settlementKey) {
      (global as any).__lastSettlementHourKey = settlementKey;
      console.log("[CRON] Running scheduled match results settlement...");
      try {
        const scanRes = await runAutomaticResultsScan();
        cronStatusInfo.lastSettlementTime = new Date().toISOString();
        cronStatusInfo.lastSettlementStatus = `Settled ${scanRes.settledCount} matches`;
      } catch (e: any) {
        console.error("[CRON] Settlement error:", e.message);
        cronStatusInfo.lastSettlementStatus = `Error: ${e.message}`;
      }
    }
  }
}

setInterval(runScheduledIngestAndSettlement, 60 * 1000);

app.get("/api/admin/cron-status", (req, res) => {
  return res.json({ success: true, cronStatus: cronStatusInfo, serverTimeUtc: new Date().toISOString() });
});

app.post("/api/admin/run-ingest-now", async (req, res) => {
  try {
    const targetDate = req.body.date || getTodayDateStrServer();
    let fixtures = await fetchSportApiAiFixtures(targetDate);
    let sourceUsed = "sportapi-ai";
    if (!fixtures || fixtures.length === 0) {
      fixtures = await fetchTheRundownFixtures(targetDate);
      sourceUsed = "therundown";
    }
    const manifest = loadPersistedFixturesFromDisk();
    const merged = mergeServerSlates(manifest, fixtures || []);
    saveFixturesToDisk(merged);

    cronStatusInfo.lastIngestTime = new Date().toISOString();
    cronStatusInfo.lastIngestStatus = `Manual ingest success: ${(fixtures || []).length} fixtures from ${sourceUsed}`;

    return res.json({
      success: true,
      message: `Successfully ingested ${(fixtures || []).length} fixtures from ${sourceUsed} for ${targetDate}`,
      fixtures: merged,
      source: sourceUsed
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Failsafe recommendation generator when AI quota is exhausted
// No synthetic self-improvement coefficients are generated on API failure.

// 2. API: Research self-improvement sports modeling breakthroughs
app.post("/api/self-improvement", async (req, res) => {
  try {
    const { currentCoefficients } = req.body;
    const client = getGeminiClient();

    const systemPrompt = `You are a state-of-the-art predictive sports analytics research system.
Analyze modern advancements in predictive football modeling and reinforcement learning.
Focus on:
1. "Shot accuracy gaps against compact defensive low-blocks"
2. Geographic volatility dampening in fast-paced leagues (Japan, Norway, Sweden, South Korea, China)
3. Pitch fatigue decay over 3-to-4 day game cycles.

You will output a JSON object proposing recommended adjustment values for our global coefficients:
- home_advantage_multiplier (standard default is around 1.12)
- form_momentum_weight (standard default around 0.95)
- volatility_index (geographic dampener modifier)
- fatigue_penalty_modifier (default penalty around 0.92)

Also output detailed "meta_improvement_notes" explaining the tactical or academic justification for these modifications based on the researched parameters.`;

    const response = await client.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: "Research the latest predictive football models for 2026. Propose fine-tuned weights and generate structured improvement logs.",
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommended_coefficients: {
              type: Type.OBJECT,
              properties: {
                home_advantage_multiplier: { type: Type.NUMBER },
                form_momentum_weight: { type: Type.NUMBER },
                volatility_index: { type: Type.NUMBER, description: "Volatility index offset or scaling" },
                fatigue_penalty_modifier: { type: Type.NUMBER }
              },
              required: ["home_advantage_multiplier", "form_momentum_weight", "volatility_index", "fatigue_penalty_modifier"]
            },
            meta_improvement_notes: { 
              type: Type.STRING, 
              description: "A highly analytical summary log detailing changes based on shot accuracy gaps in compact defenses and geographical league data." 
            }
          },
          required: ["recommended_coefficients", "meta_improvement_notes"]
        }
      }
    });

    const recommendation = JSON.parse(response.text || "{}");
    return res.json(recommendation);
  } catch (err: any) {
    console.error("Self-improvement research unavailable:", err.message);
    return res.status(503).json({ error: "Research service unavailable. No synthetic coefficients were generated.", coefficients: null });
  }
});

// Serve frontend assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Football Analytical Engine server listening on port ${PORT}`);
  });
}

startServer();
