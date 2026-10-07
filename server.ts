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

  return {
    result: simulateMatchup(
      match.homeTeam,
      match.awayTeam,
      homeMatrix.learned_coefficients,
      awayMatrix.learned_coefficients,
      match.wasDerby,
      match.homeRank,
      match.awayRank,
      match.homeContinentalGap,
      match.awayContinentalGap,
      match.opponentLowBlock,
      match.hasHighShotAccuracy,
      match.possessionRatio,
      homeMatrix.sample_size_matches,
      awayMatrix.sample_size_matches
    ),
    homeCoefficients: homeMatrix.learned_coefficients,
    awayCoefficients: awayMatrix.learned_coefficients
  };
}

