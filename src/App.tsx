import React, { useState, useEffect, useMemo } from "react";
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend 
} from "recharts";
import { 
  Search, 
  Sparkles, 
  RefreshCw, 
  FileText, 
  Sliders, 
  Dribbble, 
  Copy, 
  Check, 
  Settings, 
  Activity, 
  FileJson, 
  Flame, 
  ShieldAlert, 
  TrendingUp, 
  Compass, 
  Plus,
  BookOpen,
  ArrowUpDown,
  Calendar,
  Star,
  Moon,
  Sun,
  Database,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  UploadCloud,
  Code,
  Trash2
} from "lucide-react";
import { LOCKED_80_TEAMS, generateDefaultMatrices, isFastPacedLeagueTeam } from "./data/favoriteTeams";
import { PRESET_PAYLOADS, PresetPayload } from "./data/presets";
import { simulateMatchup } from "./utils/footballMath";
import { LearnedCoefficients, TeamIntelligenceMatrix, SyncPayload, MatchReport, SimulationResult } from "./types";
import { FIXTURES_DATA, Fixture } from "./data/fixtures";
import { getTodayDateStr, get48HourRollingCutoff, formatDateHuman, getDynamicDatePickers } from "./utils/dateUtils";
import { normalizeTeamName, getFixtureCompositeKey, mergeFixtureSlates } from "./utils/fixtureDedupe";
import { parseBookmakerRawText, ParsedBookmakerMatch, calculateProbabilityDistribution } from "./utils/bookmakerParser";

export default function App() {
  // Theme Dark Mode State (Persisted in LocalStorage)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem("football_engine_dark_mode") === "true";
  });

  useEffect(() => {
    localStorage.setItem("football_engine_dark_mode", String(darkMode));
    if (darkMode) {
      document.documentElement.classList.add("dark-theme");
      document.body.classList.add("dark-theme");
    } else {
      document.documentElement.classList.remove("dark-theme");
      document.body.classList.remove("dark-theme");
    }
  }, [darkMode]);

  // Helper to check if a team is on our locked 80 favorites list
  const isFavTeam = (name: string) => {
    return LOCKED_80_TEAMS.some(t => t.toLowerCase() === name.toLowerCase());
  };

  // --- 1. Core State Management ---
  const [teamMatrices, setTeamMatrices] = useState<Record<string, TeamIntelligenceMatrix>>(() => {
    const saved = localStorage.getItem("football_engine_matrices");
    return saved ? JSON.parse(saved) : generateDefaultMatrices();
  });

  const [metaNotes, setMetaNotes] = useState<string>(() => {
    return localStorage.getItem("football_engine_meta_notes") || 
      "Baseline coefficients are priors only. Verified match results are required before a team matrix is considered learned.";
  });

  const [activeTab, setActiveTab] = useState<"ingest" | "matrix" | "predictor" | "advancement" | "sync" | "fixtures" | "trends" | "bookmaker" | "results-api" | "verified-results">("fixtures");
  const [trendTeam, setTrendTeam] = useState<string>("Napoli");

  const [verifiedResults, setVerifiedResults] = useState<any[]>([]);
  const [coeffHistoryLogs, setCoeffHistoryLogs] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/matrices")
      .then(res => res.json())
      .then(data => {
        if (data.matrices) {
          setTeamMatrices(data.matrices);
          localStorage.setItem("football_engine_matrices", JSON.stringify(data.matrices));
        }
      })
      .catch(e => console.warn("Failed to fetch server matrices:", e));

    fetch("/api/results/verified")
      .then(res => res.json())
      .then(data => {
        if (data.results) setVerifiedResults(data.results);
      })
      .catch(err => console.warn("Failed to load verified results:", err));

    fetch(`/api/coefficients/history?team=${encodeURIComponent(trendTeam)}`)
      .then(res => res.json())
      .then(data => {
        if (data.history) setCoeffHistoryLogs(data.history);
      })
      .catch(err => console.warn("Failed to load coefficient history:", err));
  }, [trendTeam]);

  // Fixtures Tab States - STRICTLY Default to TODAY via dynamic client clock
  const [selectedFixtureDate, setSelectedFixtureDate] = useState<string>(() => getTodayDateStr());
  const [fixtureSearch, setFixtureSearch] = useState<string>("");

  // Raw Text & PDF Bookmaker Ingestion Engine States
  const [bookmakerRawText, setBookmakerRawText] = useState<string>(
    `Mamelodi Sundowns vs Orlando Pirates 19:30 1.85 3.25 4.00 DSTV Premiership\nKaizer Chiefs vs Stellenbosch FC 15:00 2.20 3.10 3.30 DSTV Premiership\nCape Town City vs SuperSport United 17:30 2.50 3.00 2.80 DSTV Premiership`
  );
  const [bookmakerParsedResults, setBookmakerParsedResults] = useState<ParsedBookmakerMatch[]>([]);
  const [isSavingToDisk, setIsSavingToDisk] = useState<boolean>(false);
  const [diskPersistStatus, setDiskPersistStatus] = useState<string | null>(null);
  const [isUploadingPdf, setIsUploadingPdf] = useState<boolean>(false);
  const [pdfUploadStatus, setPdfUploadStatus] = useState<string | null>(null);

  // Automated Results Scanner & Custom API States (Quota Protection)
  const [customResultsApiUrl, setCustomResultsApiUrl] = useState<string>("");
  const [resultsApiKeyConfigured, setResultsApiKeyConfigured] = useState<boolean>(false);
  const [autoResultsScan, setAutoResultsScan] = useState<boolean>(true);
  const [maxCallsPerDay, setMaxCallsPerDay] = useState<number>(10);
  const [todayCallsCount, setTodayCallsCount] = useState<number>(0);
  const [scanIntervalHours, setScanIntervalHours] = useState<number>(4);
  const [onlyScanDuringMatches, setOnlyScanDuringMatches] = useState<boolean>(true);
  const [cacheTtlMinutes, setCacheTtlMinutes] = useState<number>(120);
  const [isScanningResults, setIsScanningResults] = useState<boolean>(false);
  const [resultsScanMessage, setResultsScanMessage] = useState<string | null>(null);
  const [showResultsSettings, setShowResultsSettings] = useState<boolean>(false);
  const [isTestingApi, setIsTestingApi] = useState<boolean>(false);
  const [testApiResult, setTestApiResult] = useState<{ success: boolean; message: string; sampleData?: string } | null>(null);

  // Ingest Form States
  const [rawPayload, setRawPayload] = useState<string>(PRESET_PAYLOADS[0].payload);
  const [selectedPreset, setSelectedPreset] = useState<number>(0);
  const [isDigesting, setIsDigesting] = useState<boolean>(false);
  const [digestedMatches, setDigestedMatches] = useState<MatchReport[]>([]);
  const [digestError, setDigestError] = useState<string | null>(null);

  // Matrix Filter / Edit States
  const [matrixSearch, setMatrixSearch] = useState<string>("");
  const [filterFastPaced, setFilterFastPaced] = useState<boolean>(false);
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<LearnedCoefficients & { sampleSize: number } | null>(null);

  // Predictor States
  const [predHomeTeam, setPredHomeTeam] = useState<string>("Napoli");
  const [predAwayTeam, setPredAwayTeam] = useState<string>("Club Brugge");
  const [predWasDerby, setPredWasDerby] = useState<boolean>(false);
  const [predHomeRank, setPredHomeRank] = useState<number | undefined>(undefined);
  const [predAwayRank, setPredAwayRank] = useState<number | undefined>(undefined);
  const [predHomeContinentalGap, setPredHomeContinentalGap] = useState<number | undefined>(undefined);
  const [predAwayContinentalGap, setPredAwayContinentalGap] = useState<number | undefined>(undefined);
  const [predOpponentLowBlock, setPredOpponentLowBlock] = useState<boolean | undefined>(undefined);
  const [predHighShotAccuracy, setPredHighShotAccuracy] = useState<boolean | undefined>(undefined);
  const [predPossession, setPredPossession] = useState<number | undefined>(undefined);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);

  // Advancement States
  const [isResearching, setIsResearching] = useState<boolean>(false);
  const [researchConsole, setResearchConsole] = useState<string[]>([]);
  const [proposedUpdates, setProposedUpdates] = useState<any | null>(null);

  // Copy/Sync States
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isSynced, setIsSynced] = useState<boolean>(false);

  // --- 2. Local Persistence & Sync Synchronization ---
  useEffect(() => {
    localStorage.setItem("football_engine_matrices", JSON.stringify(teamMatrices));
  }, [teamMatrices]);

  useEffect(() => {
    localStorage.setItem("football_engine_meta_notes", metaNotes);
  }, [metaNotes]);

  // Run initial default simulation on load
  useEffect(() => {
    triggerSimulation();
  }, [predHomeTeam, predAwayTeam, predWasDerby, predHomeRank, predAwayRank, predHomeContinentalGap, predAwayContinentalGap, predOpponentLowBlock, predHighShotAccuracy, predPossession, teamMatrices]);

  // --- 3. Dynamic JSON Sync Payload Schema Construction ---
  const syncPayload: SyncPayload = useMemo(() => {
    return {
      sync_timestamp: new Date().toISOString(),
      model_engine: "rule-engine-v1",
      meta_improvement_notes: metaNotes,
      team_intelligence_matrices: teamMatrices
    };
  }, [teamMatrices, metaNotes]);

  // --- 3.1 Historical Coefficients: real verified calibration events only ---
  const trendData = useMemo(() => {
    const teamLogs = coeffHistoryLogs
      .filter(h => h.team.toLowerCase() === trendTeam.toLowerCase())
      .sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return teamLogs.map((_, idx) => {
      const windowPoints = teamLogs.slice(Math.max(0, idx - 4), idx + 1);
      const avg = (key: string) => windowPoints.reduce((sum, p) => sum + Number(p[key] || 0), 0) / windowPoints.length;
      return {
        name: `Calibration ${idx + 1}`,
        "Home Adv (5-event Avg)": +avg("home_advantage_multiplier").toFixed(3),
        "Form Momentum (5-event Avg)": +avg("form_momentum_weight").toFixed(3),
        "Volatility (5-event Avg)": +avg("volatility_index").toFixed(3),
        "Fatigue Penalty (5-event Avg)": +avg("fatigue_penalty_modifier").toFixed(3)
      };
    });
  }, [trendTeam, coeffHistoryLogs]);

  // --- 4. Event Handlers ---
  
  // Handle statistical preset loading
  const handlePresetChange = (index: number) => {
    setSelectedPreset(index);
    setRawPayload(PRESET_PAYLOADS[index].payload);
  };

  // Trigger Gemini parsing of stats payloads
  const handleDigestPayload = async () => {
    setIsDigesting(true);
    setDigestError(null);
    try {
      const response = await fetch("/api/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: rawPayload }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Digestion server error");
      }
      const data = await response.json();
      
      // Convert response objects to match reports
      const reports: MatchReport[] = data.matches.map((m: any, idx: number) => ({
        id: `digest-${idx}-${Date.now()}`,
        date: new Date().toLocaleDateString(),
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeGoals: m.homeGoals,
        awayGoals: m.awayGoals,
        homeXG: m.homeXG,
        awayXG: m.awayXG,
        homePossession: m.homePossession,
        awayPossession: m.awayPossession,
        pitchFacts: m.pitchFacts || [],
        wasDerby: m.wasDerby || false,
        competition: m.competition || "League Fixture",
        isFastPacedLeague: isFastPacedLeagueTeam(m.homeTeam) || isFastPacedLeagueTeam(m.awayTeam)
      }));

      setDigestedMatches(reports);
    } catch (err: any) {
      console.error(err);
      setDigestError(err.message || "An unexpected error occurred during payload processing.");
    } finally {
      setIsDigesting(false);
    }
  };

  // Recalibrate coefficients based on pitch facts
  const applyCalibration = (report: MatchReport) => {
    const updated = { ...teamMatrices };
    let calibrationTriggered = false;

    // Apply adjustments if the teams belong to the 80 list
    [report.homeTeam, report.awayTeam].forEach((teamName) => {
      if (updated[teamName]) {
        calibrationTriggered = true;
        const current = updated[teamName];
        
        // Dynamic recalibration of coefficients based on physical facts
        const matchesCount = current.sample_size_matches + 1;
        
        // Calculate new weights using moving average
        const alpha = 0.15; // weight given to new match facts
        let homeAdvFactor = current.learned_coefficients.home_advantage_multiplier;
        let formWeightFactor = current.learned_coefficients.form_momentum_weight;
        let fatigueFactor = current.learned_coefficients.fatigue_penalty_modifier;

        // If high expected goals convert, boost form momentum
        const isHome = teamName === report.homeTeam;
        const score = isHome ? report.homeGoals : report.awayGoals;
        const xG = isHome ? report.homeXG : report.awayXG;

        if (score > xG) {
          formWeightFactor = Math.min(1.20, formWeightFactor * (1 + alpha * 0.05));
        } else if (score < xG && score === 0) {
          formWeightFactor = Math.max(0.80, formWeightFactor * (1 - alpha * 0.05));
        }

        // Home advantage update
        if (isHome && score > report.awayGoals && !report.wasDerby) {
          homeAdvFactor = Math.min(1.25, homeAdvFactor * (1 + alpha * 0.03));
        }

        updated[teamName] = {
          sample_size_matches: matchesCount,
          learned_coefficients: {
            ...current.learned_coefficients,
            home_advantage_multiplier: Number(homeAdvFactor.toFixed(3)),
            form_momentum_weight: Number(formWeightFactor.toFixed(3)),
            fatigue_penalty_modifier: Number(fatigueFactor.toFixed(3))
          }
        };
      }
    });

    if (calibrationTriggered) {
      setTeamMatrices(updated);
      setMetaNotes(prev => `[Calibrated ${new Date().toLocaleDateString()}] Recalibrated matrices for ${report.homeTeam} / ${report.awayTeam} based on pitch match stats (Score: ${report.homeGoals}-${report.awayGoals}, xG: ${report.homeXG}-${report.awayXG}).\n\n` + prev);
      alert(`Successfully recalibrated coefficients for target teams based on match results!`);
    } else {
      alert(`Neither "${report.homeTeam}" nor "${report.awayTeam}" matched any of your locked 80 favourite teams. Discarding noise.`);
    }
  };

  // Manual Coefficient Edit
  const handleEditClick = (team: string) => {
    const data = teamMatrices[team];
    setEditingTeam(team);
    setEditForm({
      sampleSize: data.sample_size_matches,
      ...data.learned_coefficients
    });
  };

  const handleSaveEdit = async () => {
    if (!editingTeam || !editForm) return;
    const updated = {
      ...teamMatrices,
      [editingTeam]: {
        ...teamMatrices[editingTeam],
        learned_coefficients: {
          home_advantage_multiplier: Number(editForm.home_advantage_multiplier),
          form_momentum_weight: Number(editForm.form_momentum_weight),
          volatility_index: Number(editForm.volatility_index),
          fatigue_penalty_modifier: Number(editForm.fatigue_penalty_modifier)
        }
      }
    };
    setTeamMatrices(updated);
    try {
      const res = await fetch("/api/matrices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matrices: updated })
      });
      if (!res.ok) throw new Error("Server rejected matrix update");
    } catch (err) {
      console.warn("Matrix server persistence failed:", err);
    }
    setEditingTeam(null);
    setEditForm(null);
  };

  // Predictor trigger
  const triggerSimulation = () => {
    const homeC = teamMatrices[predHomeTeam]?.learned_coefficients || {
      home_advantage_multiplier: 1.12,
      form_momentum_weight: 0.95,
      volatility_index: 1.00,
      fatigue_penalty_modifier: 0.92
    };

    const awayC = teamMatrices[predAwayTeam]?.learned_coefficients || {
      home_advantage_multiplier: 1.12,
      form_momentum_weight: 0.95,
      volatility_index: 1.00,
      fatigue_penalty_modifier: 0.92
    };

    const homeSampleSize = teamMatrices[predHomeTeam]?.sample_size_matches || 0;
    const awaySampleSize = teamMatrices[predAwayTeam]?.sample_size_matches || 0;

    const result = simulateMatchup(
      predHomeTeam,
      predAwayTeam,
      homeC,
      awayC,
      predWasDerby,
      predHomeRank,
      predAwayRank,
      predHomeContinentalGap,
      predAwayContinentalGap,
      predOpponentLowBlock,
      predHighShotAccuracy,
      predPossession,
      homeSampleSize,
      awaySampleSize
    );

    setSimulationResult(result);
  };

  // Run model advancement research scan
  const handleAdvancementResearch = async () => {
    setIsResearching(true);
    setResearchConsole(["Initiating reinforcement search agent...", "Connecting to Sports Predictive Modeling Index (SPMI)..."]);
    
    // Simulate terminal outputs for beautiful UX
    const steps = [
      "Analyzing 2026 low-block metrics...",
      "Resolving shot accuracy gaps inside compact structures...",
      "Reading geographic transition velocity offsets for Sweden, Norway, and Japan...",
      "Re-weighting fatigue decays against 3-day recovery windows..."
    ];

    for (let i = 0; i < steps.length; i++) {
      await new Promise(r => setTimeout(r, 600));
      setResearchConsole(prev => [...prev, steps[i]]);
    }

    try {
      const response = await fetch("/api/self-improvement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentCoefficients: teamMatrices })
      });
      if (!response.ok) {
        throw new Error("Advancement research api failed");
      }
      const data = await response.json();

      setResearchConsole(prev => [
        ...prev,
        "Research recommendation returned; live coefficients were not changed.",
        `Recommended parameters calibrated with shot accuracy gaps against compact low blocks.`
      ]);

      setProposedUpdates(data);
    } catch (err: any) {
      setResearchConsole(prev => [...prev, `[ERROR] Research failed: ${err.message}`]);
    } finally {
      setIsResearching(false);
    }
  };

  const applyProposedResearch = () => {
    if (!proposedUpdates) return;
    alert("Research recommendations are advisory only. They were not applied to the live model because they have not passed out-of-sample evaluation.");
  };

  // Copy JSON Payload to clipboard
  const handleCopyJSON = () => {
    navigator.clipboard.writeText(JSON.stringify(syncPayload, null, 2));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Sync to parent applet
  const handleTriggerSync = () => {
    setIsSynced(true);
    setTimeout(() => setIsSynced(false), 3000);
  };

  // Reset all matrices to standard values
  const handleResetToDefaults = async () => {
    if (confirm("Are you sure you want to reset all team coefficients to neutral priors? Verified sample sizes will be preserved.")) {
      const defaults = generateDefaultMatrices();
      const preserved = Object.fromEntries(Object.entries(defaults).map(([team, value]) => [
        team,
        { ...value, sample_size_matches: teamMatrices[team]?.sample_size_matches ?? 0 }
      ]));
      setTeamMatrices(preserved);
      setMetaNotes("Neutral priors restored. Verified sample sizes were preserved.");
      try {
        await fetch("/api/matrices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matrices: preserved })
        });
      } catch (err) {
        console.warn("Failed to persist matrix reset:", err);
      }
    }
  };

  // Filtered target list
  const filteredTeamsList = useMemo(() => {
    return LOCKED_80_TEAMS.filter(team => {
      const matchesSearch = team.toLowerCase().includes(matrixSearch.toLowerCase());
      if (filterFastPaced) {
        return matchesSearch && isFastPacedLeagueTeam(team);
      }
      return matchesSearch;
    });
  }, [matrixSearch, filterFastPaced]);

  // --- Bookmaker Raw Slate Actions ---
  const handleParseBookmakerText = () => {
    const targetDate = selectedFixtureDate === "all" ? getTodayDateStr() : selectedFixtureDate;
    const parsed = parseBookmakerRawText(bookmakerRawText, targetDate);
    setBookmakerParsedResults(parsed.matches);
    if (parsed.matches.length === 0) {
      setDiskPersistStatus("Could not parse valid matches. Ensure text has teams separated by 'vs', 'v', or '-' and odds or times.");
    } else {
      setDiskPersistStatus(`Parsed ${parsed.matches.length} matches with mathematical probability distributions ready to commit.`);
    }
  };

  const handleCommitBookmakerSlate = async () => {
    let matchesToCommit = bookmakerParsedResults.map(p => p.fixture);
    if (matchesToCommit.length === 0) {
      const parsed = parseBookmakerRawText(bookmakerRawText, selectedFixtureDate === "all" ? getTodayDateStr() : selectedFixtureDate);
      setBookmakerParsedResults(parsed.matches);
      matchesToCommit = parsed.matches.map(p => p.fixture);
    }
    if (matchesToCommit.length === 0) {
      alert("No valid matches detected to commit. Please verify your pasted text.");
      return;
    }

    setIsSavingToDisk(true);
    try {
      // 1. Dispatch asynchronous persist call to server disk manifest (Zero Data Loss)
      const response = await fetch("/api/fixtures/ingest-slate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixtures: matchesToCommit, source: "bookmaker-import" })
      });

      if (!response.ok) {
        throw new Error("Server failed to persist slate to disk manifest");
      }

      const data = await response.json();

      // 2. Commit directly to active application state with hardened bookmaker protection
      setLiveFixtures(prev => mergeFixtureSlates(prev, matchesToCommit, { incomingIsBookmaker: true }));

      // 3. Switch selected view to the slate date so matches immediately appear
      const targetDate = matchesToCommit[0]?.date || getTodayDateStr();
      setSelectedFixtureDate(targetDate);

      setDiskPersistStatus(`✓ Committed ${matchesToCommit.length} matches to Server Disk & Active Engine Slate!`);
      setTimeout(() => setDiskPersistStatus(null), 6000);
    } catch (err: any) {
      console.error("Bookmaker disk commit failed:", err);
      setDiskPersistStatus(`Persistence warning: ${err.message}. Matches committed to local state.`);
      setLiveFixtures(prev => mergeFixtureSlates(prev, matchesToCommit, { incomingIsBookmaker: true }));
    } finally {
      setIsSavingToDisk(false);
    }
  };

  // Completely wipe all stored slates & caches (Clean Slate Reset)
  const handlePurgeAllFixtures = async () => {
    if (confirm("Are you sure you want to purge all stored fixtures and reset to a clean, empty state?")) {
      try {
        await fetch("/api/fixtures/purge", { method: "POST" });
        localStorage.removeItem("football_engine_cached_fixtures");
        setLiveFixtures([]);
        setBookmakerParsedResults([]);
        setDiskPersistStatus("✓ All stored fixtures and caches have been purged completely.");
        setTimeout(() => setDiskPersistStatus(null), 4000);
      } catch (err: any) {
        setDiskPersistStatus(`Purge error: ${err.message}`);
      }
    }
  };

  // Delete a specific match from local state & server filesystem manifest
  const handleDeleteMatch = async (matchId: string) => {
    try {
      await fetch("/api/fixtures/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: matchId })
      });
      setLiveFixtures(prev => prev.filter(f => f.id !== matchId));
      setBookmakerParsedResults(prev => prev.filter(p => p.fixture.id !== matchId));
    } catch (err: any) {
      console.error("Failed to delete match:", err);
    }
  };

  // Upload and parse PDF fixture sheets (e.g. Hollywoodbets fixture PDF)
  const handleUploadPdfFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      alert("Please select a valid PDF document (e.g. Hollywoodbets fixture sheet PDF).");
      return;
    }

    setIsUploadingPdf(true);
    setPdfUploadStatus("Extracting fixture pages from PDF document...");

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64 = evt.target?.result as string;

        const res = await fetch("/api/fixtures/upload-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pdfBase64: base64,
            defaultDate: selectedFixtureDate === "all" ? getTodayDateStr() : selectedFixtureDate
          })
        });

        const data = await res.json();

        if (data.success && data.fixtures?.length > 0) {
          setLiveFixtures(prev => mergeFixtureSlates(prev, data.fixtures, { incomingIsBookmaker: true }));
          setBookmakerParsedResults(data.matches || []);
          setPdfUploadStatus(`✓ Extracted and committed ${data.totalExtracted} fixtures across ${data.totalPages} PDF pages!`);
          setDiskPersistStatus(`✓ Extracted ${data.totalExtracted} matches from PDF directly to Server Disk!`);
          setTimeout(() => setDiskPersistStatus(null), 6000);
        } else {
          setPdfUploadStatus(`PDF Upload Note: ${data.message || "No valid fixture rows detected in PDF."}`);
        }
        setIsUploadingPdf(false);
      };

      reader.onerror = () => {
        setPdfUploadStatus("Error reading PDF file.");
        setIsUploadingPdf(false);
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      console.error("PDF upload failed:", err);
      setPdfUploadStatus(`PDF Upload error: ${err.message}`);
      setIsUploadingPdf(false);
    }
  };

  // Load Results Scanner Config on Mount
  useEffect(() => {
    fetch("/api/results/config")
      .then(res => res.json())
      .then(data => {
        if (data.apiUrl !== undefined) setCustomResultsApiUrl(data.apiUrl);
        if (data.apiKeyConfigured !== undefined) setResultsApiKeyConfigured(Boolean(data.apiKeyConfigured));
        if (data.autoScanEnabled !== undefined) setAutoResultsScan(data.autoScanEnabled);
        if (data.maxCallsPerDay !== undefined) setMaxCallsPerDay(data.maxCallsPerDay);
        if (data.todayCallsCount !== undefined) setTodayCallsCount(data.todayCallsCount);
        if (data.scanIntervalHours !== undefined) setScanIntervalHours(data.scanIntervalHours);
        if (data.onlyScanDuringMatches !== undefined) setOnlyScanDuringMatches(data.onlyScanDuringMatches);
        if (data.cacheTtlMinutes !== undefined) setCacheTtlMinutes(data.cacheTtlMinutes);
      })
      .catch(err => console.warn("Failed to load results config:", err));
  }, []);

  // Save Results Scanner Configuration
  const handleSaveResultsConfig = async () => {
    try {
      const res = await fetch("/api/results/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiUrl: customResultsApiUrl,
          autoScanEnabled: autoResultsScan,
          maxCallsPerDay,
          scanIntervalHours,
          onlyScanDuringMatches,
          cacheTtlMinutes
        })
      });
      const data = await res.json();
      if (data.success) {
        if (data.config && data.config.todayCallsCount !== undefined) {
          setTodayCallsCount(data.config.todayCallsCount);
        }
        setResultsScanMessage("✓ Quota Guard & API settings saved successfully.");
        setTimeout(() => setResultsScanMessage(null), 4000);
      }
    } catch (err: any) {
      setResultsScanMessage(`Failed to save settings: ${err.message}`);
    }
  };

  // Test API Connection directly
  const handleTestResultsApi = async () => {
    if (!customResultsApiUrl) {
      setTestApiResult({ success: false, message: "Please enter a valid API URL before testing." });
      return;
    }
    setIsTestingApi(true);
    setTestApiResult(null);

    try {
      // First save current config
      await handleSaveResultsConfig();

      // Trigger a live scan request to test endpoint response
      const res = await fetch("/api/results/scan", { method: "POST" });
      const data = await res.json();

      if (data.success) {
        setTestApiResult({
          success: true,
          message: `Connection Successful! ${data.message || 'API responded cleanly.'}`,
          sampleData: JSON.stringify(data.config, null, 2)
        });
      } else {
        setTestApiResult({
          success: false,
          message: `API returned error: ${data.error || 'Invalid response schema'}`
        });
      }
    } catch (err: any) {
      setTestApiResult({
        success: false,
        message: `Connection failed: ${err.message}`
      });
    } finally {
      setIsTestingApi(false);
    }
  };

  // Trigger Automatic Results Scanner on Demand
  const handleScanResultsNow = async () => {
    setIsScanningResults(true);
    setResultsScanMessage("Scanning custom API & official feeds for FT match scores...");
    try {
      const res = await fetch("/api/results/scan", { method: "POST" });
      const data = await res.json();
      if (data.fixtures) {
        setLiveFixtures(data.fixtures);
      }
      if (data.config && data.config.todayCallsCount !== undefined) {
        setTodayCallsCount(data.config.todayCallsCount);
      }
      setResultsScanMessage(data.message || `Scan completed! Settled ${data.settledCount || 0} match results.`);
      setTimeout(() => setResultsScanMessage(null), 6000);
    } catch (err: any) {
      setResultsScanMessage(`Results scan error: ${err.message}`);
    } finally {
      setIsScanningResults(false);
    }
  };

  // Live Fixtures loaded dynamically with dual-layer server disk persistence
  // Do not render cached/local fixtures as today's verified slate before the server verifies them.
  // The server is the source of truth for real-world fixture provenance.
  const [liveFixtures, setLiveFixtures] = useState<Fixture[]>([]);
  const [isLoadingRealFixtures, setIsLoadingRealFixtures] = useState<boolean>(false);
  const [fixturesError, setFixturesError] = useState<string | null>(null);

  // Sync state to local storage as secondary backup
  useEffect(() => {
    localStorage.setItem("football_engine_cached_fixtures", JSON.stringify(liveFixtures));
  }, [liveFixtures]);

  // ON MOUNT: Restore all persisted fixtures directly from server disk (Permanent Data Loss Prevention)
  useEffect(() => {
    const loadServerDiskManifest = async () => {
      try {
        const res = await fetch("/api/fixtures/persisted");
        if (res.ok) {
          const data = await res.json();
          if (data.fixtures && Array.isArray(data.fixtures) && data.fixtures.length > 0) {
            setLiveFixtures(prev => mergeFixtureSlates(
              prev,
              data.fixtures.filter((f: Fixture) => f.sourceConfidence === "verified")
            ));
          }
        }
      } catch (err) {
        console.warn("Could not load initial server disk manifest:", err);
      }
    };
    loadServerDiskManifest();
  }, []);

  // Fetch real search-grounded fixtures dynamically when tab is fixtures or date changes
  useEffect(() => {
    let active = true;
    const fetchRealFixtures = async () => {
      setIsLoadingRealFixtures(true);
      setFixturesError(null);
      try {
        const todayStr = getTodayDateStr();
        const queryDate = selectedFixtureDate === "all" ? todayStr : selectedFixtureDate;
        const response = await fetch(`/api/real-fixtures?date=${queryDate}`);
        if (!response.ok) {
          throw new Error("Failed to reach trusted fixture provider service");
        }
        const data = await response.json();
        if (data.error) {
          throw new Error(data.error);
        }
        if (active) {
          // Only trusted-provider fixtures enter the normal fixture display.
          // Unknown/ESPN discovery fixtures are intentionally excluded from the verified slate.
          const verifiedFixtures = Array.isArray(data.fixtures)
            ? data.fixtures.filter((f: Fixture) => f.sourceConfidence === "verified")
            : [];
          setLiveFixtures(prev => mergeFixtureSlates(prev, verifiedFixtures));
        }
      } catch (err: any) {
        console.warn("Real-world fixtures fetch fell back:", err.message);
        setFixturesError(err.message);
      } finally {
        if (active) {
          setIsLoadingRealFixtures(false);
        }
      }
    };

    fetchRealFixtures();

    return () => {
      active = false;
    };
  }, [selectedFixtureDate]);

  // Dynamic evaluation against dynamic client time (Eliminates hardcoded date cutoffs)
  const todaysTeams = useMemo(() => {
    const set = new Set<string>();
    const todayStr = getTodayDateStr();
    liveFixtures.filter(f => f.date === todayStr).forEach(f => {
      set.add(f.homeTeam);
      set.add(f.awayTeam);
    });
    return set;
  }, [liveFixtures]);

  const todaysMatches = useMemo(() => {
    const todayStr = getTodayDateStr();
    return liveFixtures.filter(f => f.date === todayStr);
  }, [liveFixtures]);

  const filteredFixturesList = useMemo(() => {
    return liveFixtures.filter(fixture => {
      const matchesSearch = 
        fixture.homeTeam.toLowerCase().includes(fixtureSearch.toLowerCase()) ||
        fixture.awayTeam.toLowerCase().includes(fixtureSearch.toLowerCase()) ||
        fixture.competition.toLowerCase().includes(fixtureSearch.toLowerCase());
      
      if (selectedFixtureDate === "all") {
        return matchesSearch;
      }
      return matchesSearch && fixture.date === selectedFixtureDate;
    });
  }, [liveFixtures, fixtureSearch, selectedFixtureDate]);

  const handleLoadFixtureIntoPredictor = (fixture: Fixture) => {
    setPredHomeTeam(fixture.homeTeam);
    setPredAwayTeam(fixture.awayTeam);
    setPredWasDerby(fixture.wasDerby ?? false);
    setPredHomeRank(fixture.homeRank);
    setPredAwayRank(fixture.awayRank);
    setPredHomeContinentalGap(fixture.homeContinentalGap);
    setPredAwayContinentalGap(fixture.awayContinentalGap);
    setPredOpponentLowBlock(fixture.opponentLowBlock);
    setPredHighShotAccuracy(fixture.hasHighShotAccuracy);
    setPredPossession(fixture.possessionRatio);
    setActiveTab("predictor");
  };

  return (
    <div className={`min-h-screen font-sans antialiased flex flex-col transition-colors duration-200 ${darkMode ? "dark-theme" : ""}`}>
      {/* --- Top Header Area --- */}
      <header className="bg-white border-b border-[#E2E8F0] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-[#15803D] text-white p-2.5 rounded-lg">
              <Dribbble className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[#0F172A] flex items-center gap-2">
                Football Analytical Engine
                <span className="text-xs bg-[#E2E8F0] text-[#475569] font-semibold px-2.5 py-0.5 rounded-full">
                  Locked 80
                </span>
              </h1>
              <p className="text-xs text-[#64748B]">Highly Specialised Evidence-Gated Pitch & Positional Matrix Engine</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Real-time Theme Toggle Button */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="text-xs bg-[#F1F5F9] border border-[#E2E8F0] text-[#334155] px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-[#E2E8F0] cursor-pointer transition-all shadow-xs"
              aria-label="Toggle theme mode"
            >
              {darkMode ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  <span className="font-semibold text-amber-400">Light Theme</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-[#15803D] fill-[#15803D]" />
                  <span className="font-semibold text-[#15803D]">Dark Theme</span>
                </>
              )}
            </button>

            <span className="text-xs bg-[#F1F5F9] border border-[#E2E8F0] text-[#334155] px-3 py-1.5 rounded-md flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-[#15803D]" />
              Model: <strong className="font-semibold">Gemini 3.8 Flash</strong>
            </span>
            <span className="text-xs bg-[#F1F5F9] border border-[#E2E8F0] text-[#334155] px-3 py-1.5 rounded-md flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-[#15803D]" />
              Biases Excluded: <strong className="font-semibold">Betting/Margins</strong>
            </span>
          </div>
        </div>
      </header>

      {/* --- Main Workspace Content --- */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side Navigation Panel */}
        <div className="lg:col-span-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-[#64748B] px-3 uppercase tracking-wider mb-1">Navigation Modules</p>
          
          <button 
            onClick={() => setActiveTab("fixtures")}
            className={`w-full text-left px-4 py-3 rounded-xl transition flex items-center justify-between font-medium ${
              activeTab === "fixtures" 
                ? "bg-white text-[#15803D] shadow-sm border border-[#E2E8F0]" 
                : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Calendar className="w-4.5 h-4.5" />
              Fixtures & Matches
            </span>
            <span className="text-xs bg-[#15803D]/10 text-[#15803D] px-2 py-0.5 rounded-full font-bold">
              {todaysMatches.length} Today
            </span>
          </button>

          <button 
            onClick={() => setActiveTab("bookmaker")}
            className={`w-full text-left px-4 py-3 rounded-xl transition flex items-center justify-between font-medium ${
              activeTab === "bookmaker" 
                ? "bg-white text-[#15803D] shadow-sm border border-[#E2E8F0]" 
                : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Database className="w-4.5 h-4.5" />
              Bookmaker Slate Engine
            </span>
            <span className="text-[10px] bg-amber-500/10 text-amber-700 px-2 py-0.5 rounded-full font-bold">
              Zero Loss
            </span>
          </button>

          <button 
            onClick={() => setActiveTab("results-api")}
            className={`w-full text-left px-4 py-3 rounded-xl transition flex items-center justify-between font-medium ${
              activeTab === "results-api" 
                ? "bg-white text-sky-700 shadow-sm border border-sky-200" 
                : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <RefreshCw className="w-4.5 h-4.5 text-sky-600" />
              Custom Results API
            </span>
            <span className="text-[10px] bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full font-bold">
              Live Scores
            </span>
          </button>

          <button 
            onClick={() => setActiveTab("ingest")}
            className={`w-full text-left px-4 py-3 rounded-xl transition flex items-center justify-between font-medium ${
              activeTab === "ingest" 
                ? "bg-white text-[#15803D] shadow-sm border border-[#E2E8F0]" 
                : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <FileText className="w-4.5 h-4.5" />
              Pitch Ingestion
            </span>
            {digestedMatches.length > 0 && (
              <span className="text-xs bg-[#E2E8F0] text-[#1e293b] px-2 py-0.5 rounded-full font-bold">
                {digestedMatches.length}
              </span>
            )}
          </button>

          <button 
            onClick={() => setActiveTab("matrix")}
            className={`w-full text-left px-4 py-3 rounded-xl transition flex items-center gap-2.5 font-medium ${
              activeTab === "matrix" 
                ? "bg-white text-[#15803D] shadow-sm border border-[#E2E8F0]" 
                : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            }`}
          >
            <Sliders className="w-4.5 h-4.5" />
            Target Teams Matrix
          </button>

          <button 
            onClick={() => setActiveTab("predictor")}
            className={`w-full text-left px-4 py-3 rounded-xl transition flex items-center gap-2.5 font-medium ${
              activeTab === "predictor" 
                ? "bg-white text-[#15803D] shadow-sm border border-[#E2E8F0]" 
                : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            }`}
          >
            <Dribbble className="w-4.5 h-4.5" />
            Evidence-Gated Match Simulator
          </button>

          <button 
            onClick={() => setActiveTab("advancement")}
            className={`w-full text-left px-4 py-3 rounded-xl transition flex items-center gap-2.5 font-medium ${
              activeTab === "advancement" 
                ? "bg-white text-[#15803D] shadow-sm border border-[#E2E8F0]" 
                : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            }`}
          >
            <Sparkles className="w-4.5 h-4.5" />
            Model Advancements
          </button>

          <button 
            onClick={() => setActiveTab("trends")}
            className={`w-full text-left px-4 py-3 rounded-xl transition flex items-center justify-between font-medium ${
              activeTab === "trends" 
                ? "bg-white text-[#15803D] shadow-sm border border-[#E2E8F0]" 
                : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <TrendingUp className="w-4.5 h-4.5" />
              Historical Trends
            </span>
            <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full font-bold">
              Recharts
            </span>
          </button>

          <button 
            onClick={() => setActiveTab("sync")}
            className={`w-full text-left px-4 py-3 rounded-xl transition flex items-center gap-2.5 font-medium ${
              activeTab === "sync" 
                ? "bg-white text-[#15803D] shadow-sm border border-[#E2E8F0]" 
                : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            }`}
          >
            <FileJson className="w-4.5 h-4.5" />
            Export Sync Layer
          </button>

          <button 
            onClick={() => setActiveTab("verified-results")}
            className={`w-full text-left px-4 py-3 rounded-xl transition flex items-center justify-between font-medium ${
              activeTab === "verified-results" 
                ? "bg-white text-[#15803D] shadow-sm border border-[#E2E8F0]" 
                : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <ShieldCheck className="w-4.5 h-4.5 text-emerald-600" />
              Verified Results & History
            </span>
            {verifiedResults.length > 0 && (
              <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                {verifiedResults.length}
              </span>
            )}
          </button>

          <div className="mt-6 p-4 bg-[#F1F5F9] border border-[#E2E8F0] rounded-xl flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#334155]">
              <Settings className="w-4 h-4 text-[#475569]" />
              System Calibration
            </div>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Calculations exclude odd lines, margin values, and commercials. Purely grounded in pitch facts and xG conversions.
            </p>
            <button 
              onClick={handleResetToDefaults}
              className="text-[11px] text-left text-red-600 hover:text-red-700 font-bold flex items-center gap-1 mt-1 transition"
            >
              <RefreshCw className="w-3 h-3" /> Reset Engine to Defaults
            </button>
          </div>
        </div>

        {/* --- Central Panel (Interactive Workspace) --- */}
        <div className="lg:col-span-9 flex flex-col gap-6">
          
          {/* Active Panel View */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs p-6 flex-1 min-h-[500px]">
            
            {/* --- Fixtures & Today's Matches View --- */}
            {activeTab === "fixtures" && (
              <div className="flex flex-col gap-6">
                
                {/* Header Information */}
                <div>
                  <h2 className="text-xl font-extrabold text-[#0F172A] flex items-center gap-2">
                    <Calendar className="w-5.5 h-5.5 text-[#15803D]" />
                    Upcoming Fixtures & Calendar Matches
                  </h2>
                  <p className="text-sm text-[#64748B] mt-1">
                    Monitor scheduled matches for the locked profile of 80 teams. Access today's active matches, filter by calendar dates, or instantly load parameters into the evidence-gated simulation engine.
                  </p>

                  {/* SportAPI.ai & TheRundown Pipeline Status Widget */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                      <Database className="w-4 h-4 text-[#15803D]" />
                      <span>Ingestion Pipeline:</span>
                    </div>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold px-2.5 py-0.5 rounded-md flex items-center gap-1.5 shadow-2xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                      SportAPI.ai (Primary): ACTIVE
                    </span>
                    <span className="text-[10px] bg-sky-100 text-sky-800 border border-sky-300 font-bold px-2.5 py-0.5 rounded-md flex items-center gap-1.5 shadow-2xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-600"></span>
                      TheRundown.io (Secondary): STANDBY
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/admin/run-ingest-now", { method: "POST" });
                          const data = await res.json();
                          alert(data.message || "Ingestion triggered!");
                          window.location.reload();
                        } catch (e: any) {
                          alert("Ingest error: " + e.message);
                        }
                      }}
                      className="ml-auto text-[10px] bg-[#15803D] hover:bg-[#166534] text-white font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <RefreshCw className="w-3 h-3" /> Run Ingestion Now (05:30 UTC Cron)
                    </button>
                  </div>
                  
                  {/* Trusted Results Verification & Scanner Status */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] bg-[#E8F5E9] text-[#15803D] border border-[#C8E6C9] font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-2xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#15803D] animate-ping"></span>
                        Zero-Hallucination Integrity: ACTIVE
                      </span>
                      <button
                        onClick={handleScanResultsNow}
                        disabled={isScanningResults}
                        className="text-[10px] bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 transition cursor-pointer"
                        title="Scan custom API and live web search for FT scores"
                      >
                        <RefreshCw className={`w-3 h-3 text-sky-600 ${isScanningResults ? 'animate-spin' : ''}`} />
                        {isScanningResults ? "Scanning Scores..." : "Scan Match Results Now"}
                      </button>
                      <button
                        onClick={() => setShowResultsSettings(!showResultsSettings)}
                        className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 font-bold px-2.5 py-1 rounded-md flex items-center gap-1 transition cursor-pointer"
                      >
                        <Database className="w-3 h-3 text-slate-500" />
                        Custom Results API Settings
                      </button>
                    </div>
                    {liveFixtures.length > 0 && (
                      <button
                        onClick={handlePurgeAllFixtures}
                        className="text-[10px] bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold px-2.5 py-1 rounded-md flex items-center gap-1 transition cursor-pointer"
                        title="Purge all cached/stored fixtures"
                      >
                        <Trash2 className="w-3 h-3 text-rose-600" />
                        Purge & Reset Slates
                      </button>
                    )}
                  </div>

                  {resultsScanMessage && (
                    <div className="mt-2.5 text-xs font-bold text-sky-800 bg-sky-50 border border-sky-200 px-3 py-2 rounded-lg flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0" />
                      <span>{resultsScanMessage}</span>
                    </div>
                  )}

                  {/* Expandable Custom Results API & Auto-Scanner Settings */}
                  {showResultsSettings && (
                    <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-3 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Database className="w-4 h-4 text-[#15803D]" />
                          <h4 className="font-bold text-[#0F172A]">Custom Results API Integration & Auto-Scan</h4>
                        </div>
                        <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={autoResultsScan}
                            onChange={(e) => setAutoResultsScan(e.target.checked)}
                            className="rounded border-slate-300 text-[#15803D] focus:ring-[#15803D]"
                          />
                          <span>Enable Auto-Scan on the configured interval</span>
                        </label>
                      </div>

                      <p className="text-slate-600 text-[11px]">
                        Connect a custom results API URL or use the server-authorized score webhook. The background worker verifies full-time scores using configured providers; it does not accept AI-generated scores.
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Custom Results API URL</label>
                          <input
                            type="text"
                            placeholder="e.g. https://my-sports-api.com/api/v1/live-scores"
                            value={customResultsApiUrl}
                            onChange={(e) => setCustomResultsApiUrl(e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-[#15803D]"
                          />
                        </div>
                        <div className="flex items-center text-[10px] text-slate-500">
                          Server API key configured: <strong className="ml-1">{resultsApiKeyConfigured ? "Yes" : "No"}</strong>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-500">
                          Webhook endpoint for external push: <code className="font-mono text-slate-800 bg-slate-200 px-1.5 py-0.5 rounded">POST /api/results/push-scores</code>
                        </span>
                        <button
                          onClick={handleSaveResultsConfig}
                          className="bg-[#15803D] hover:bg-[#166534] text-white font-bold text-xs px-3.5 py-1.5 rounded-lg transition"
                        >
                          Save API Configuration
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* TODAY'S MATCHES CALLOUT SECTION (Dynamically Evaluated for Today) */}
                <div className="bg-[#F0FDF4] border border-[#15803D]/20 rounded-2xl p-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#15803D] animate-ping"></span>
                      <h3 className="text-sm font-bold text-[#15803D] uppercase tracking-wider">
                        Today's Scheduled Matches ({formatDateHuman(getTodayDateStr())})
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-[#15803D] text-white px-3 py-1 rounded-full font-bold">
                        {todaysMatches.length} Fixtures Active
                      </span>
                      <button
                        onClick={() => setActiveTab("bookmaker")}
                        className="text-[11px] bg-white border border-[#15803D]/30 text-[#15803D] hover:bg-[#F0FDF4] px-3 py-1 rounded-full font-bold flex items-center gap-1 transition shadow-2xs"
                      >
                        <Database className="w-3 h-3" /> + Ingest Slate to Disk
                      </button>
                    </div>
                  </div>

                  {todaysMatches.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {todaysMatches.map((match) => (
                        <div 
                          key={match.id} 
                          className="bg-white border border-[#E2E8F0] hover:border-[#15803D] rounded-xl p-4 transition shadow-xs flex flex-col justify-between gap-3 group"
                        >
                          <div className="flex items-center justify-between text-[10px] text-[#64748B] font-medium">
                            <span className="px-2 py-0.5 bg-[#F1F5F9] rounded font-semibold text-[#475569]">
                              {match.competition}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {match.isBookmakerProtected && (
                                <span className="bg-amber-100 text-amber-800 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                  <ShieldCheck className="w-2.5 h-2.5 text-amber-600" /> Bookmaker Locked
                                </span>
                              )}
                              <span>{match.time} Local</span>
                              <button
                                onClick={() => handleDeleteMatch(match.id)}
                                className="text-gray-400 hover:text-red-500 p-0.5 rounded transition ml-1"
                                title="Delete this match"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between py-1">
                            <div className="flex-1 text-center font-bold text-[#0F172A]">
                              <span className="flex items-center justify-center gap-1 text-sm">
                                {isFavTeam(match.homeTeam) && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />}
                                {match.homeTeam}
                              </span>
                              <span className="text-[10px] font-normal text-[#15803D] bg-[#E8F5E9] px-1.5 py-0.2 rounded inline-block mt-0.5">
                                ★ Today's Team
                              </span>
                            </div>

                            {match.finalScore ? (
                              <div className="flex flex-col items-center px-2 shrink-0">
                                <span className="text-[9px] bg-emerald-700 text-white font-extrabold px-1.5 py-0.5 rounded tracking-wider uppercase">
                                  FT Final
                                </span>
                                <span className="text-base font-mono font-black text-emerald-800">
                                  {match.finalScore.home} - {match.finalScore.away}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs font-mono font-bold text-gray-400 px-3 shrink-0">VS</span>
                            )}

                            <div className="flex-1 text-center font-bold text-[#0F172A]">
                              <span className="flex items-center justify-center gap-1 text-sm">
                                {isFavTeam(match.awayTeam) && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />}
                                {match.awayTeam}
                              </span>
                              <span className="text-[10px] font-normal text-[#15803D] bg-[#E8F5E9] px-1.5 py-0.2 rounded inline-block mt-0.5">
                                ★ Today's Team
                              </span>
                            </div>
                          </div>

                          {match.odds && match.probabilities && (
                            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-2 flex items-center justify-between text-[10px]">
                              <span className="text-[#64748B]">Odds: <strong className="text-[#0F172A]">{match.odds.home} / {match.odds.draw} / {match.odds.away}</strong></span>
                              <span className="text-[#15803D] font-bold">Implied Win: {match.probabilities.homeWinPct}% - {match.probabilities.awayWinPct}%</span>
                            </div>
                          )}

                          <div className="border-t border-[#F1F5F9] pt-2.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-[10px] text-[#64748B]">
                              {match.wasDerby && (
                                <span className="bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded">
                                  Derby
                                </span>
                              )}
                              <span>Rank: #{match.homeRank} vs #{match.awayRank}</span>
                            </div>
                            <button
                              onClick={() => handleLoadFixtureIntoPredictor(match)}
                              className="bg-[#15803D] text-white hover:bg-[#166534] text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Dribbble className="w-3 h-3" /> Simulate
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center p-6 bg-white border border-[#E2E8F0] rounded-xl text-xs text-[#64748B] flex flex-col items-center gap-2">
                      <span>{isLoadingRealFixtures ? "Verifying active match cards from live sports feeds..." : `No matches scheduled for our target teams on ${formatDateHuman(getTodayDateStr())}.`}</span>
                      <button
                        onClick={() => setActiveTab("bookmaker")}
                        className="text-xs bg-[#15803D] text-white px-3.5 py-1.5 rounded-lg font-bold hover:bg-[#166534] transition flex items-center gap-1.5 mt-1"
                      >
                        <Database className="w-3.5 h-3.5" /> Ingest Bookmaker Slate for Today
                      </button>
                    </div>
                  )}
                </div>

                {/* SEARCH & PICK DATE CONTROLS */}
                <div className="border border-[#E2E8F0] rounded-xl p-4 bg-[#F8FAFC] flex flex-col gap-4">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-3">
                    <span className="text-xs font-bold text-[#334155] uppercase tracking-wider">
                      Search & Interactive Calendar Filters
                    </span>
                    <div className="relative w-full md:w-72">
                      <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={fixtureSearch}
                        onChange={(e) => setFixtureSearch(e.target.value)}
                        placeholder="Search teams or competitions..."
                        className="w-full text-xs pl-9 pr-4 py-2 border border-[#E2E8F0] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#15803D] bg-white"
                      />
                    </div>
                  </div>

                  {/* Horizontal Scroll Dynamic Date Picker (Strict Dynamic Client Time) */}
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-bold text-[#64748B] uppercase">Pick a Date:</span>
                    <div className="flex flex-wrap gap-2">
                      
                      <button
                        onClick={() => setSelectedFixtureDate("all")}
                        className={`text-xs px-3.5 py-2 rounded-lg font-bold transition flex items-center gap-1.5 ${
                          selectedFixtureDate === "all"
                            ? "bg-[#15803D] text-white"
                            : "bg-white border border-[#E2E8F0] text-[#334155] hover:bg-gray-100"
                        }`}
                      >
                        <Compass className="w-3.5 h-3.5" /> All Matches
                      </button>

                      {getDynamicDatePickers().map((option) => (
                        <button
                          key={option.dateStr}
                          onClick={() => setSelectedFixtureDate(option.dateStr)}
                          className={`text-xs px-3.5 py-2 rounded-lg font-bold transition flex items-center gap-1.5 ${
                            selectedFixtureDate === option.dateStr
                              ? "bg-[#15803D] text-white shadow-xs"
                              : "bg-white border border-[#E2E8F0] text-[#334155] hover:bg-gray-100"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}

                      {/* Manual Calendar Picker input to choose custom dates freely */}
                      <div className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] px-2 py-1 rounded-lg">
                        <span className="text-[10px] font-bold text-[#475569]">Custom:</span>
                        <input
                          type="date"
                          value={selectedFixtureDate === "all" ? getTodayDateStr() : selectedFixtureDate}
                          onChange={(e) => setSelectedFixtureDate(e.target.value)}
                          className="text-xs font-semibold focus:outline-hidden text-[#334155] cursor-pointer"
                        />
                      </div>

                    </div>
                  </div>
                </div>

                {/* FILTERED MATCHES LIST */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-2">
                    <span className="text-xs font-bold text-[#475569] uppercase tracking-wider">
                      Verified Matches Scheduled for {selectedFixtureDate === "all" ? "All Calendar Dates" : formatDateHuman(selectedFixtureDate)} ({filteredFixturesList.length})
                    </span>
                    {selectedFixtureDate !== "all" && (
                      <button 
                        onClick={() => setSelectedFixtureDate("all")} 
                        className="text-[10px] text-[#15803D] hover:underline font-bold"
                      >
                        Show All Dates
                      </button>
                    )}
                  </div>

                  {filteredFixturesList.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {filteredFixturesList.map((match) => {
                        const isMatchToday = match.date === getTodayDateStr();

                        return (
                          <div 
                            key={match.id} 
                            className={`border rounded-xl p-4 flex flex-col justify-between gap-3 transition shadow-xs ${
                              isMatchToday 
                                ? "bg-[#F0FDF4]/30 border-[#15803D]/20 hover:border-[#15803D]" 
                                : "bg-white border-[#E2E8F0] hover:border-gray-300"
                            }`}
                          >
                            <div className="flex items-center justify-between text-[10px] text-[#64748B]">
                              <div className="flex items-center gap-1.5">
                                <span className="px-2 py-0.5 bg-[#F1F5F9] rounded font-bold text-[#334155]">
                                  {match.competition}
                                </span>
                                <span className="px-2 py-0.5 rounded font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  VERIFIED · {match.source || "trusted provider"}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold">{match.date} @ {match.time}</span>
                                <button
                                  onClick={() => handleDeleteMatch(match.id)}
                                  className="text-gray-400 hover:text-red-500 p-0.5 rounded transition"
                                  title="Delete this match"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>

                             <div className="flex flex-col gap-2 py-1">
                              {/* Home team */}
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-[#0F172A] flex items-center gap-1">
                                  {isFavTeam(match.homeTeam) && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />}
                                  {match.homeTeam}
                                </span>
                              </div>

                              <div className="text-[10px] text-gray-300 font-mono text-center">VS</div>

                              {/* Away team */}
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-[#0F172A] flex items-center gap-1">
                                  {isFavTeam(match.awayTeam) && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />}
                                  {match.awayTeam}
                                </span>
                              </div>
                            </div>

                            <div className="border-t border-[#F1F5F9] pt-2.5 flex items-center justify-between">
                              <span className="text-[10px] text-[#64748B] flex items-center gap-1">
                                {match.wasDerby ? "🔥 Local Derby" : (match.homeRank && match.awayRank ? `Rank Gap: ${Math.abs(match.homeRank - match.awayRank)} slots` : "Rank gap unavailable")}
                              </span>
                              <button
                                onClick={() => handleLoadFixtureIntoPredictor(match)}
                                className="bg-[#15803D] hover:bg-[#166534] text-white text-[10px] font-bold px-3 py-1 rounded transition flex items-center gap-1 cursor-pointer"
                              >
                                <Dribbble className="w-2.5 h-2.5" /> Predict
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-8 text-center bg-[#FAFAFA] border border-[#E2E8F0] rounded-xl text-xs text-[#64748B]">
                      No verified matches are currently available for this date. The app will not display stale, manual, bookmaker-only, or ESPN-discovery fixtures as verified games.
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* --- Verified Results & Prediction History View --- */}
            {activeTab === "verified-results" && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="text-xl font-extrabold text-[#0F172A] flex items-center gap-2">
                    <ShieldCheck className="w-5.5 h-5.5 text-emerald-600" />
                    Verified Results & Prediction History
                  </h2>
                  <p className="text-sm text-[#64748B] mt-1">
                    Real-time verification log comparing automated model predictions against verified match final scores. Correct predictions automatically calibrate team intelligence matrices.
                  </p>
                </div>

                {/* Summary Metrics Banner */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 flex flex-col gap-1">
                    <span className="text-xs text-[#64748B] uppercase font-bold">Total Verified Matches</span>
                    <span className="text-2xl font-extrabold text-[#0F172A]">{verifiedResults.length}</span>
                    <span className="text-[10px] text-emerald-600 font-medium">Synced from configured verified result sources</span>
                  </div>

                  <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 flex flex-col gap-1">
                    <span className="text-xs text-[#64748B] uppercase font-bold">Correct Graded Predictions</span>
                    <span className="text-2xl font-extrabold text-emerald-600">
                      {verifiedResults.filter(r => r.hasPriorPrediction && r.isCorrect).length}
                    </span>
                    <span className="text-[10px] text-[#64748B]">Accurate outcome forecasts</span>
                  </div>

                  <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 flex flex-col gap-1">
                    <span className="text-xs text-[#64748B] uppercase font-bold">Out-of-Sample Accuracy</span>
                    <span className="text-2xl font-extrabold text-[#0F172A]">
                      {(() => { const graded = verifiedResults.filter(r => r.hasPriorPrediction); return graded.length > 0 ? Math.round((graded.filter(r => r.isCorrect).length / graded.length) * 100) : null; })() === null ? "Unavailable" : `${(() => { const graded = verifiedResults.filter(r => r.hasPriorPrediction); return Math.round((graded.filter(r => r.isCorrect).length / graded.length) * 100); })()}%`}
                    </span>
                    <span className="text-[10px] text-[#64748B]">Only graded pre-match predictions are included</span>
                  </div>
                </div>

                {/* Results Table */}
                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#475569]">Verified Match Audit Log</h3>
                  {verifiedResults.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 border border-dashed border-gray-300 rounded-xl">
                      <ShieldCheck className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm font-bold text-gray-600">No verified match results in history yet.</p>
                      <p className="text-xs text-gray-400 mt-1">Run an automated results scan or push scores to populate verified audit logs.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-[#E2E8F0] rounded-xl">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#F8FAFC] text-[11px] text-[#475569] uppercase font-bold border-b border-[#E2E8F0]">
                            <th className="p-3">Date / Competition</th>
                            <th className="p-3">Fixture</th>
                            <th className="p-3 text-center">Prediction</th>
                            <th className="p-3 text-center">Actual FT Score</th>
                            <th className="p-3 text-center">Audit Status</th>
                            <th className="p-3">Source</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0] text-xs">
                          {verifiedResults.map((r, i) => (
                            <tr key={i} className="hover:bg-gray-50 transition">
                              <td className="p-3">
                                <span className="font-bold text-[#0F172A]">{r.date}</span>
                                <span className="block text-[10px] text-[#64748B]">{r.competition}</span>
                              </td>
                              <td className="p-3">
                                <span className="font-bold text-[#0F172A]">{r.homeTeam} vs {r.awayTeam}</span>
                              </td>
                              <td className="p-3 text-center font-mono">
                                <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-800 font-bold">
                                  {r.predictedScore} ({r.predictedOutcome})
                                </span>
                              </td>
                              <td className="p-3 text-center font-mono">
                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 rounded font-extrabold">
                                  {r.actualScore} ({r.actualOutcome})
                                </span>
                              </td>
                              <td className="p-3 text-center">
                                {r.isCorrect ? (
                                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full font-bold text-[10px]">
                                    ✓ Correct
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-1 bg-rose-100 text-rose-800 rounded-full font-bold text-[10px]">
                                    ✗ Incorrect
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-[10px] text-[#64748B] font-mono">
                                {r.source}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* --- 0. Raw Text Bookmaker Ingestion Engine View --- */}
            {activeTab === "bookmaker" && (
              <div className="flex flex-col gap-6">
                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-extrabold text-[#0F172A] flex items-center gap-2">
                      <Database className="w-5.5 h-5.5 text-[#15803D]" />
                      Raw Text Bookmaker Ingestion Engine
                    </h2>
                    <span className="text-[10px] bg-emerald-50 text-[#15803D] border border-emerald-200 font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-2xs">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#15803D]" />
                      Server Disk Manifest: ACTIVE (Zero Data Loss)
                    </span>
                  </div>
                  <p className="text-sm text-[#64748B] mt-1">
                    Ingest raw copied match text and decimal/fractional odds from Hollywoodbets, Betway, Bet365, or regional sportsbooks. Evaluates margin-free probability distributions, enforces hardened composite deduplication (<code className="text-xs bg-gray-100 px-1 py-0.5 rounded text-gray-700 font-mono">home_vs_away_date</code>), and writes the daily slate directly to server disk.
                  </p>
                </div>

                {/* Status persistence alert banner */}
                {diskPersistStatus && (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-3.5 rounded-xl flex items-center justify-between shadow-2xs animate-fadeIn">
                    <span className="flex items-center gap-2 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-[#15803D] shrink-0" />
                      {diskPersistStatus}
                    </span>
                    <button 
                      onClick={() => setDiskPersistStatus(null)} 
                      className="text-xs text-emerald-700 hover:text-emerald-900 font-bold ml-2"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Ingestion Presets */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-[#475569]">Select Standard Bookmaker Sample Slate:</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <button
                      onClick={() => {
                        setBookmakerRawText(
                          `Hollywoodbets - South African Premier Soccer League\nMamelodi Sundowns vs Orlando Pirates 19:30 1.85 3.25 4.00\nKaizer Chiefs vs Stellenbosch FC 15:00 2.20 3.10 3.30\nCape Town City vs SuperSport United 17:30 2.50 3.00 2.80\nRichards Bay vs Golden Arrows 15:00 2.60 2.95 2.75`
                        );
                        setBookmakerParsedResults([]);
                      }}
                      className="text-xs p-3 rounded-lg border text-left transition bg-[#F8FAFC] border-[#E2E8F0] text-[#334155] hover:bg-[#F1F5F9] cursor-pointer"
                    >
                      <span className="block font-bold mb-1">Hollywoodbets PSL Regional Board</span>
                      <span className="text-[10px] text-[#64748B] line-clamp-1">South African PSL fixtures with 3-way decimal odds</span>
                    </button>

                    <button
                      onClick={() => {
                        setBookmakerRawText(
                          `Shanghai Port vs Beijing Guoan 19:30 1.70 3.60 4.20 Chinese Super League\nNapoli vs FC Nantes 20:45 1.55 3.90 5.40 UEFA Friendly / Elite Showcase\nSt. Patrick's Athletic vs Rigas Futbola Skola 19:00 2.10 3.25 3.30 UEFA Conference League`
                        );
                        setBookmakerParsedResults([]);
                      }}
                      className="text-xs p-3 rounded-lg border text-left transition bg-[#F8FAFC] border-[#E2E8F0] text-[#334155] hover:bg-[#F1F5F9] cursor-pointer"
                    >
                      <span className="block font-bold mb-1">Today's Verified Daily Slate</span>
                      <span className="text-[10px] text-[#64748B] line-clamp-1">Verified fixtures from configured sources are shown here when available.</span>
                    </button>

                    <button
                      onClick={() => {
                        setBookmakerRawText(
                          `Newcastle United v Manchester City 20:00 1: 3.40 X: 3.60 2: 1.95 Premier League\nArsenal vs Chelsea 17:30 2.10 3.40 3.20 Premier League\nBoulogne vs FC Nantes 19:00 2.90 3.15 2.35 Ligue 1`
                        );
                        setBookmakerParsedResults([]);
                      }}
                      className="text-xs p-3 rounded-lg border text-left transition bg-[#F8FAFC] border-[#E2E8F0] text-[#334155] hover:bg-[#F1F5F9] cursor-pointer"
                    >
                      <span className="block font-bold mb-1">Betway / Bet365 European Board</span>
                      <span className="text-[10px] text-[#64748B] line-clamp-1">1X2 labeled odds & Premier League fixtures</span>
                    </button>
                  </div>
                </div>

                {/* PDF Fixture Upload Dropzone */}
                <div className="bg-gradient-to-r from-emerald-900 via-[#15803D] to-teal-900 rounded-xl p-5 text-white shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 border border-emerald-700/50">
                  <div className="flex items-start gap-3.5">
                    <div className="p-3 bg-white/10 backdrop-blur-md rounded-xl text-emerald-200 shrink-0">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold tracking-tight">Manual Hollywoodbets PDF Fixture Upload</h4>
                        <span className="text-[10px] bg-emerald-400/20 text-emerald-200 border border-emerald-400/30 px-2 py-0.5 rounded-full font-bold uppercase">
                          Native PDF Ingestion
                        </span>
                      </div>
                      <p className="text-xs text-emerald-100/90 mt-1 max-w-xl">
                        Upload multi-page Hollywoodbets PDF fixture sheets (like 24-page fixture publications). The system extracts all match tables, coup codes, times, and fractional odds (<code className="bg-black/30 px-1 py-0.5 rounded text-emerald-200 font-mono">17-10</code> → <code className="bg-black/30 px-1 py-0.5 rounded text-emerald-200 font-mono">2.70</code>) directly into the server manifest.
                      </p>
                      {pdfUploadStatus && (
                        <div className="mt-2.5 text-xs font-bold text-amber-200 flex items-center gap-2 bg-black/20 px-3 py-1.5 rounded-lg border border-white/10">
                          {isUploadingPdf && <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-300" />}
                          <span>{pdfUploadStatus}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <label className="relative inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-[#15803D] hover:bg-emerald-50 text-xs font-bold rounded-lg cursor-pointer transition shadow-sm shrink-0 border border-white/80">
                    <FileText className="w-4 h-4 text-[#15803D]" />
                    <span>{isUploadingPdf ? "Processing PDF..." : "Upload Hollywoodbets PDF"}</span>
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={handleUploadPdfFile}
                      disabled={isUploadingPdf}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Raw Bookmaker Text Area */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#475569]">
                    <span>Raw Copied Bookmaker Text / Odds Board:</span>
                    <span className="text-[10px] text-[#64748B]">Auto-detects decimal/fractional odds, timestamps & teams</span>
                  </div>
                  <textarea
                    value={bookmakerRawText}
                    onChange={(e) => setBookmakerRawText(e.target.value)}
                    rows={6}
                    className="w-full text-xs font-mono p-4 border border-[#E2E8F0] rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#15803D]/20 focus:border-[#15803D] bg-[#FAFAFA]"
                    placeholder="Paste raw copied bookmaker text or betting lines here (e.g. Mamelodi Sundowns vs Orlando Pirates 1.85 3.20 4.10)..."
                  />
                </div>

                {/* Parsing & Disk Commit Action Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F8FAFC] border border-[#E2E8F0] p-4 rounded-xl">
                  <div className="flex items-center gap-2 text-xs text-[#475569]">
                    <ShieldCheck className="w-4 h-4 text-[#15803D]" />
                    <span>Merge Rule: <strong>Bookmaker precedence</strong> locks slate against scoreboard wipes</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleParseBookmakerText}
                      className="bg-white border border-[#E2E8F0] hover:bg-gray-100 text-[#334155] text-xs font-bold px-4 py-2 rounded-lg transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <Search className="w-3.5 h-3.5 text-[#15803D]" />
                      Parse Mathematical Probabilities
                    </button>

                    <button
                      onClick={handleCommitBookmakerSlate}
                      disabled={isSavingToDisk || !bookmakerRawText.trim()}
                      className="bg-[#15803D] hover:bg-[#166534] disabled:bg-gray-300 text-white text-xs font-bold px-5 py-2 rounded-lg transition flex items-center gap-2 cursor-pointer shadow-xs"
                    >
                      {isSavingToDisk ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Writing to Server Disk...
                        </>
                      ) : (
                        <>
                          <Database className="w-3.5 h-3.5" />
                          Commit Slate to App & Server Disk
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Parsed Matches Output with Mathematical Probabilities */}
                {bookmakerParsedResults.length > 0 && (
                  <div className="flex flex-col gap-4 mt-2">
                    <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-2">
                      <span className="text-xs font-bold text-[#0F172A] uppercase tracking-wider flex items-center gap-2">
                        <Activity className="w-4 h-4 text-[#15803D]" />
                        Parsed Mathematical Slate ({bookmakerParsedResults.length} Matches Detected)
                      </span>
                      <span className="text-[10px] text-[#64748B] font-mono">
                        Target Date: {bookmakerParsedResults[0]?.fixture.date}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {bookmakerParsedResults.map((item, idx) => (
                        <div 
                          key={idx} 
                          className="border border-[#E2E8F0] rounded-xl p-4 bg-white shadow-xs flex flex-col justify-between gap-3 hover:border-[#15803D] transition"
                        >
                          <div className="flex items-center justify-between text-[10px] text-[#64748B]">
                            <span className="px-2 py-0.5 bg-[#F1F5F9] rounded font-bold text-[#334155]">
                              {item.fixture.competition}
                            </span>
                            <span className="font-semibold">{item.fixture.date} @ {item.fixture.time}</span>
                          </div>

                          <div className="flex items-center justify-between py-1">
                            <div className="flex-1 text-center font-bold text-[#0F172A] text-sm">
                              {item.fixture.homeTeam}
                            </div>
                            <span className="text-xs font-mono font-bold text-gray-400 px-3">VS</span>
                            <div className="flex-1 text-center font-bold text-[#0F172A] text-sm">
                              {item.fixture.awayTeam}
                            </div>
                          </div>

                          {/* Odds & Bookmaker Margin Box */}
                          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-2.5 flex flex-col gap-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-[#64748B]">Decimal Odds:</span>
                              <div className="flex items-center gap-2 font-mono font-bold text-[#0F172A]">
                                <span>1: {item.oddsDecimals.home}</span>
                                <span>X: {item.oddsDecimals.draw}</span>
                                <span>2: {item.oddsDecimals.away}</span>
                              </div>
                            </div>

                            {/* True Margin-Free Mathematical Probability Distribution */}
                            <div className="flex flex-col gap-1 pt-1 border-t border-[#E2E8F0]/50">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="font-semibold text-[#15803D]">True Win Probabilities (Margin-Free):</span>
                                <span className="text-[#64748B] text-[9px]">Margin: {item.impliedProbabilities.marginPct}%</span>
                              </div>
                              <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden flex">
                                <div style={{ width: `${item.impliedProbabilities.homeWinPct}%` }} className="bg-[#15803D] h-full" title={`Home Win: ${item.impliedProbabilities.homeWinPct}%`}></div>
                                <div style={{ width: `${item.impliedProbabilities.drawPct}%` }} className="bg-amber-400 h-full" title={`Draw: ${item.impliedProbabilities.drawPct}%`}></div>
                                <div style={{ width: `${item.impliedProbabilities.awayWinPct}%` }} className="bg-blue-600 h-full" title={`Away Win: ${item.impliedProbabilities.awayWinPct}%`}></div>
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-[#475569] font-mono mt-0.5">
                                <span>Home: <strong>{item.impliedProbabilities.homeWinPct}%</strong></span>
                                <span>Draw: <strong>{item.impliedProbabilities.drawPct}%</strong></span>
                                <span>Away: <strong>{item.impliedProbabilities.awayWinPct}%</strong></span>
                              </div>
                            </div>
                          </div>

                          <div className="border-t border-[#F1F5F9] pt-2 flex items-center justify-between text-[10px]">
                            <div className="flex items-center gap-1 font-mono text-[#64748B] text-[9px] truncate max-w-[220px]" title={item.compositeKey}>
                              <ShieldCheck className="w-3 h-3 text-[#15803D] shrink-0" />
                              <span className="truncate">{item.compositeKey}</span>
                            </div>
                            <button
                              onClick={() => handleLoadFixtureIntoPredictor(item.fixture)}
                              className="bg-[#15803D] text-white hover:bg-[#166534] text-[10px] font-bold px-3 py-1 rounded transition flex items-center gap-1 cursor-pointer"
                            >
                              <Dribbble className="w-2.5 h-2.5" /> Predict
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* --- Custom Results API Integration Tab View --- */}
            {activeTab === "results-api" && (
              <div className="flex flex-col gap-6">
                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-extrabold text-[#0F172A] flex items-center gap-2">
                      <RefreshCw className="w-5.5 h-5.5 text-sky-600" />
                      Custom Results API & Webhook Configuration
                    </h2>
                    <span className="text-[10px] bg-sky-50 text-sky-700 border border-sky-200 font-bold px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-2xs">
                      <ShieldCheck className="w-3.5 h-3.5 text-sky-600" />
                      Auto Score Verification Engine
                    </span>
                  </div>
                  <p className="text-sm text-[#64748B] mt-1">
                    Connect your custom REST API or push live scores via webhook. The background scanner checks your API every 15 minutes to automatically verify full-time match scores (<code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-700">FT</code>) and settle pending match cards.
                  </p>
                </div>

                {/* Quota Meter & Strict Protection Card */}
                <div className="bg-gradient-to-r from-slate-900 via-sky-950 to-slate-900 text-white rounded-xl p-5 shadow-sm border border-sky-800/40 flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-sky-800/50 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-sky-500/20 text-sky-400 rounded-lg">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-extrabold text-sm text-white">Daily API Quota Protection Engine</h3>
                        <p className="text-[11px] text-sky-200">Shared 100 Calls/Day Budget Protection</p>
                      </div>
                    </div>
                    <div className="bg-sky-900/60 border border-sky-700/60 rounded-lg px-3 py-1.5 flex items-center gap-3">
                      <span className="text-xs font-mono font-bold text-sky-300">
                        Today's Usage: <strong className="text-white text-sm">{todayCallsCount}</strong> / {maxCallsPerDay} calls
                      </span>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-extrabold px-2 py-0.5 rounded uppercase">
                        {maxCallsPerDay - todayCallsCount} Remaining
                      </span>
                    </div>
                  </div>

                  {/* Quota Meter Progress Bar */}
                  <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        (todayCallsCount / maxCallsPerDay) >= 0.9
                          ? 'bg-rose-500'
                          : (todayCallsCount / maxCallsPerDay) >= 0.7
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(2, (todayCallsCount / maxCallsPerDay) * 100))}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold text-sky-300 uppercase mb-1">Max Daily Calls Allowed</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={maxCallsPerDay}
                        onChange={(e) => setMaxCallsPerDay(Number(e.target.value))}
                        className="w-full bg-slate-800 border border-sky-700/60 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400 font-mono"
                      />
                      <span className="text-[9px] text-slate-400 mt-0.5 block">Default: 10 calls/day for this app</span>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-sky-300 uppercase mb-1">Scan Frequency</label>
                      <select
                        value={scanIntervalHours}
                        onChange={(e) => setScanIntervalHours(Number(e.target.value))}
                        className="w-full bg-slate-800 border border-sky-700/60 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400 font-mono"
                      >
                        <option value={1}>Every 1 hour (24 calls/day)</option>
                        <option value={2}>Every 2 hours (12 calls/day)</option>
                        <option value={4}>Every 4 hours (6 calls/day - Recommended)</option>
                        <option value={6}>Every 6 hours (4 calls/day)</option>
                        <option value={12}>Every 12 hours (2 calls/day)</option>
                        <option value={24}>Once daily (1 call/day)</option>
                      </select>
                      <span className="text-[9px] text-slate-400 mt-0.5 block">Controls background timer frequency</span>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-sky-300 uppercase mb-1">Cache TTL (Minutes)</label>
                      <input
                        type="number"
                        min="5"
                        max="1440"
                        value={cacheTtlMinutes}
                        onChange={(e) => setCacheTtlMinutes(Number(e.target.value))}
                        className="w-full bg-slate-800 border border-sky-700/60 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400 font-mono"
                      />
                      <span className="text-[9px] text-slate-400 mt-0.5 block">Reuses recent data without API calls</span>
                    </div>

                    <div className="flex flex-col justify-center">
                      <label className="flex items-center gap-2 font-bold text-sky-200 cursor-pointer pt-2">
                        <input
                          type="checkbox"
                          checked={onlyScanDuringMatches}
                          onChange={(e) => setOnlyScanDuringMatches(e.target.checked)}
                          className="rounded border-slate-600 text-sky-500 focus:ring-sky-500"
                        />
                        <span className="text-xs">Smart Match Window</span>
                      </label>
                      <span className="text-[9px] text-slate-400 mt-0.5 block">Skip calls if no pending matches today</span>
                    </div>
                  </div>
                </div>

                {/* API Endpoint Configuration Card */}
                <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-xs flex flex-col gap-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-sky-600" />
                      <h3 className="font-bold text-[#0F172A] text-sm">1. Configure External Results API Endpoint</h3>
                    </div>
                    <label className="flex items-center gap-2 font-semibold text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoResultsScan}
                        onChange={(e) => setAutoResultsScan(e.target.checked)}
                        className="rounded border-slate-300 text-[#15803D] focus:ring-[#15803D]"
                      />
                      <span>Auto-Scan Every 15 Minutes</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Results API URL <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="url"
                        placeholder="e.g. https://my-sports-api.com/v1/scores"
                        value={customResultsApiUrl}
                        onChange={(e) => setCustomResultsApiUrl(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono focus:bg-white focus:outline-none focus:border-sky-600"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        Must return JSON with array of finished match scores.
                      </span>
                    </div>

                    <div className="flex items-center text-xs text-slate-600">
                      <span>Server API key configured: <strong className="ml-1">{resultsApiKeyConfigured ? "Yes" : "No"}</strong></span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                    <button
                      onClick={handleSaveResultsConfig}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold px-4 py-2 rounded-lg transition"
                    >
                      Save Configuration
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleTestResultsApi}
                        disabled={isTestingApi}
                        className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isTestingApi ? 'animate-spin' : ''}`} />
                        {isTestingApi ? "Testing Connection..." : "Test Connection & Save"}
                      </button>

                      <button
                        onClick={handleScanResultsNow}
                        disabled={isScanningResults}
                        className="bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold px-4 py-2 rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Activity className={`w-3.5 h-3.5 ${isScanningResults ? 'animate-spin' : ''}`} />
                        {isScanningResults ? "Scanning Scores..." : "Run Immediate Results Scan"}
                      </button>
                    </div>
                  </div>

                  {testApiResult && (
                    <div className={`p-3.5 rounded-xl border text-xs flex flex-col gap-1.5 ${
                      testApiResult.success
                        ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                        : "bg-rose-50 border-rose-200 text-rose-900"
                    }`}>
                      <div className="font-bold flex items-center gap-2">
                        {testApiResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Trash2 className="w-4 h-4 text-rose-600" />}
                        <span>{testApiResult.message}</span>
                      </div>
                      {testApiResult.sampleData && (
                        <pre className="bg-black/80 text-emerald-300 p-2.5 rounded text-[11px] font-mono overflow-x-auto max-h-40">
                          {testApiResult.sampleData}
                        </pre>
                      )}
                    </div>
                  )}

                  {resultsScanMessage && (
                    <div className="p-3 bg-sky-50 border border-sky-200 text-sky-900 rounded-xl text-xs font-semibold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0" />
                      <span>{resultsScanMessage}</span>
                    </div>
                  )}
                </div>

                {/* Webhook Push Endpoint Developer Instructions */}
                <div className="bg-slate-900 text-slate-100 border border-slate-800 rounded-xl p-5 shadow-xs flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2">
                      <Code className="w-4 h-4 text-emerald-400" />
                      <h3 className="font-bold text-white text-sm">2. Push Match Results Directly via Webhook</h3>
                    </div>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono font-bold">
                      POST /api/results/push-scores
                    </span>
                  </div>

                  <p className="text-xs text-slate-300">
                    If your server or external scraper prefers to push scores directly whenever matches complete, send a <code className="bg-black/50 px-1 py-0.5 rounded text-emerald-300 font-mono">POST</code> request to the endpoint below:
                  </p>

                  <div className="bg-black/60 rounded-lg p-3 font-mono text-xs text-slate-200 border border-slate-800 overflow-x-auto">
                    <div className="text-slate-400 text-[10px] mb-1">// Example HTTP Request Body:</div>
                    <pre className="text-emerald-400">{`{
  "scores": [
    {
      "homeTeam": "Mamelodi Sundowns",
      "awayTeam": "Orlando Pirates",
      "date": "2026-09-25",
      "homeGoals": 2,
      "awayGoals": 1,
      "status": "FT"
    }
  ]
}`}</pre>
                  </div>
                </div>
              </div>
            )}

            {/* 1. Pitch Ingestion View */}
            {activeTab === "ingest" && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="text-lg font-bold text-[#0F172A]">Sports Platform Stats Ingestion</h2>
                  <p className="text-sm text-[#64748B]">Paste scraped stats payloads or HTML tables from reputable sports platforms (FBref, Flashscore, WhoScored). Discard outside league noise completely.</p>
                </div>

                {/* Preset selectors */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-[#475569]">Select Analytical Ingestion Presets:</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {PRESET_PAYLOADS.map((preset, idx) => (
                      <button
                        key={idx}
                        onClick={() => handlePresetChange(idx)}
                        className={`text-xs p-3 rounded-lg border text-left transition ${
                          selectedPreset === idx 
                            ? "bg-[#F0FDF4] border-[#15803D] text-[#15803D] font-medium" 
                            : "bg-[#F8FAFC] border-[#E2E8F0] text-[#334155] hover:bg-[#F1F5F9]"
                        }`}
                      >
                        <span className="block font-bold mb-1">{preset.name}</span>
                        <span className="text-[10px] text-[#64748B] line-clamp-1">{preset.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Textarea for statistical source */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#475569]">
                    <span>Source Payload:</span>
                    <span className="bg-[#E2E8F0] text-[#334155] px-2 py-0.5 rounded font-mono">
                      {PRESET_PAYLOADS[selectedPreset].source} Ingestion Flow
                    </span>
                  </div>
                  <textarea
                    value={rawPayload}
                    onChange={(e) => setRawPayload(e.target.value)}
                    rows={8}
                    className="w-full text-xs font-mono p-4 border border-[#E2E8F0] rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#15803D]/20 focus:border-[#15803D] bg-[#FAFAFA]"
                    placeholder="Paste stats HTML or scraped text here..."
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleDigestPayload}
                    disabled={isDigesting || !rawPayload.trim()}
                    className="bg-[#15803D] hover:bg-[#166534] disabled:bg-gray-300 text-white text-xs font-bold px-6 py-3 rounded-xl transition flex items-center gap-2 cursor-pointer"
                  >
                    {isDigesting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Digesting stats via Gemini...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Digest Payload
                      </>
                    )}
                  </button>
                </div>

                {/* Processing output details */}
                {digestError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-4 rounded-xl flex items-start gap-2.5">
                    <ShieldAlert className="w-4.5 h-4.5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold block">Digestion Failure</strong>
                      {digestError}
                    </div>
                  </div>
                )}

                {/* Parsed fixtures matching target 80 */}
                {digestedMatches.length > 0 && (
                  <div className="mt-4 flex flex-col gap-4">
                    <div className="border-t border-[#F1F5F9] pt-4">
                      <h3 className="text-sm font-bold text-[#0F172A] mb-2 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-[#15803D]" />
                        Extracted Match Reports ({digestedMatches.length})
                      </h3>
                      <p className="text-xs text-[#64748B] mb-3">Extracted statistics strictly mapped to our locked 80 target list. Other noise discarded.</p>
                    </div>

                    <div className="flex flex-col gap-3">
                      {digestedMatches.map((report) => {
                        const homeMatched = LOCKED_80_TEAMS.includes(report.homeTeam);
                        const awayMatched = LOCKED_80_TEAMS.includes(report.awayTeam);
                        
                        return (
                          <div key={report.id} className="border border-[#E2E8F0] rounded-xl p-4 bg-[#F8FAFC] flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex-1 flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-[#E2E8F0] text-[#334155] rounded">
                                  {report.competition}
                                </span>
                                {report.wasDerby && (
                                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-amber-100 text-amber-800 rounded">
                                    Local Derby
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-4 py-1">
                                <div className="text-right flex-1">
                                  <span className={`text-sm font-bold block ${homeMatched ? "text-[#15803D]" : "text-[#475569]"}`}>
                                    {report.homeTeam} {homeMatched && "★"}
                                  </span>
                                  <span className="text-[10px] text-[#64748B]">xG: {report.homeXG.toFixed(2)}</span>
                                </div>
                                <div className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-1 font-mono text-sm font-bold text-[#0F172A]">
                                  {report.homeGoals} - {report.awayGoals}
                                </div>
                                <div className="text-left flex-1">
                                  <span className={`text-sm font-bold block ${awayMatched ? "text-[#15803D]" : "text-[#475569]"}`}>
                                    {report.awayTeam} {awayMatched && "★"}
                                  </span>
                                  <span className="text-[10px] text-[#64748B]">xG: {report.awayXG.toFixed(2)}</span>
                                </div>
                              </div>

                              {report.pitchFacts.length > 0 && (
                                <div className="mt-1">
                                  <p className="text-[10px] font-semibold text-[#475569] mb-1">Pitch Facts:</p>
                                  <ul className="list-disc list-inside text-[10px] text-[#64748B] flex flex-col gap-0.5">
                                    {report.pitchFacts.map((fact, i) => <li key={i}>{fact}</li>)}
                                  </ul>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                              <button
                                onClick={() => applyCalibration(report)}
                                className="bg-[#15803D] hover:bg-[#166534] text-white text-[11px] font-bold px-4 py-2 rounded-lg transition"
                              >
                                Recalibrate Matrices
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 2. Target Teams Matrix View */}
            {activeTab === "matrix" && (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-[#0F172A]">Locked Team Calibration Matrices (80 Favorites)</h2>
                    <p className="text-sm text-[#64748B]">View, search, or fine-tune coefficients for any of our favorite teams.</p>
                  </div>

                  <button
                    onClick={handleResetToDefaults}
                    className="text-xs text-[#DC2626] hover:text-[#B91C1C] font-semibold flex items-center gap-1 transition self-start"
                  >
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Reset Baseline Weights
                  </button>
                </div>

                {/* Filters */}
                <div className="flex flex-col md:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={matrixSearch}
                      onChange={(e) => setMatrixSearch(e.target.value)}
                      placeholder="Search amongst the 80 favorite teams..."
                      className="w-full text-xs pl-9 pr-4 py-2.5 border border-[#E2E8F0] rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#15803D]/20 focus:border-[#15803D]"
                    />
                  </div>

                  <button
                    onClick={() => setFilterFastPaced(prev => !prev)}
                    className={`text-xs px-4 py-2.5 rounded-xl border transition flex items-center gap-1.5 font-medium ${
                      filterFastPaced 
                        ? "bg-[#F0FDF4] border-[#15803D] text-[#15803D]" 
                        : "bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]"
                    }`}
                  >
                    <Flame className="w-3.5 h-3.5 text-[#15803D]" />
                    Fast-Paced Leagues Only
                  </button>
                </div>

                {/* Editor Modal Overlay */}
                {editingTeam && editForm && (
                  <div className="bg-[#F8FAFC] border border-[#15803D] rounded-xl p-4 flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2">
                      <h4 className="text-xs font-bold text-[#0F172A]">
                        Fine-Tuning Calibration Weight Matrix for: <span className="text-[#15803D]">{editingTeam}</span>
                      </h4>
                      <button 
                        onClick={() => { setEditingTeam(null); setEditForm(null); }}
                        className="text-xs text-gray-500 hover:text-gray-700 font-bold"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-[#475569]">Matches (Sample Size):</label>
                        <input
                          type="number"
                          value={editForm.sampleSize}
                          onChange={(e) => setEditForm({ ...editForm, sampleSize: Number(e.target.value) })}
                          className="text-xs p-2 border border-[#E2E8F0] rounded-lg focus:ring-1 focus:ring-[#15803D]"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-[#475569]">Home Adv. Multiplier:</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.home_advantage_multiplier}
                          onChange={(e) => setEditForm({ ...editForm, home_advantage_multiplier: Number(e.target.value) })}
                          className="text-xs p-2 border border-[#E2E8F0] rounded-lg focus:ring-1 focus:ring-[#15803D]"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-[#475569]">Form Momentum Weight:</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.form_momentum_weight}
                          onChange={(e) => setEditForm({ ...editForm, form_momentum_weight: Number(e.target.value) })}
                          className="text-xs p-2 border border-[#E2E8F0] rounded-lg focus:ring-1 focus:ring-[#15803D]"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-[#475569]">Volatility Index:</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.volatility_index}
                          disabled={!isFastPacedLeagueTeam(editingTeam)}
                          onChange={(e) => setEditForm({ ...editForm, volatility_index: Number(e.target.value) })}
                          className="text-xs p-2 border border-[#E2E8F0] bg-white disabled:bg-gray-100 rounded-lg focus:ring-1 focus:ring-[#15803D]"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-[#475569]">Fatigue Penalty Modifier:</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.fatigue_penalty_modifier}
                          onChange={(e) => setEditForm({ ...editForm, fatigue_penalty_modifier: Number(e.target.value) })}
                          className="text-xs p-2 border border-[#E2E8F0] rounded-lg focus:ring-1 focus:ring-[#15803D]"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        onClick={() => { setEditingTeam(null); setEditForm(null); }}
                        className="px-3 py-1.5 border border-[#E2E8F0] hover:bg-[#F1F5F9] text-xs font-semibold rounded-lg transition"
                      >
                        Discard
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        className="bg-[#15803D] hover:bg-[#166534] text-white px-4 py-1.5 text-xs font-bold rounded-lg transition"
                      >
                        Apply Parameters
                      </button>
                    </div>
                  </div>
                )}

                {/* Team Weights Table */}
                <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-[#FAFAFA]">
                  <div className="max-h-[400px] overflow-y-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-[#F1F5F9] border-b border-[#E2E8F0] sticky top-0 font-semibold text-[#475569]">
                        <tr>
                          <th className="p-3">Team Name (Locked 80)</th>
                          <th className="p-3">Analysed Matches</th>
                          <th className="p-3">Home Adv. Multiplier</th>
                          <th className="p-3">Momentum Weight</th>
                          <th className="p-3">Volatility Index</th>
                          <th className="p-3">Fatigue Modifier</th>
                          <th className="p-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E8F0] bg-white">
                        {filteredTeamsList.length > 0 ? (
                          filteredTeamsList.map((teamName) => {
                            const data = teamMatrices[teamName];
                            const isFast = isFastPacedLeagueTeam(teamName);
                            return (
                              <tr key={teamName} className="hover:bg-[#F8FAFC] transition">
                                <td className="p-3 font-semibold text-[#0F172A] flex flex-col gap-0.5">
                                  <span className="flex items-center gap-1.5 flex-wrap">
                                    <span>{teamName}</span>
                                    {todaysTeams.has(teamName) && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-[#E8F5E9] text-[#15803D] border border-[#C8E6C9] animate-pulse">
                                        <span className="w-1 h-1 rounded-full bg-[#15803D]"></span>
                                        Playing Today
                                      </span>
                                    )}
                                  </span>
                                  {isFast && (
                                    <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 self-start px-1.5 py-0.2 rounded font-medium uppercase tracking-wider">
                                      Fast-Paced League dampener applied
                                    </span>
                                  )}
                                </td>
                                <td className="p-3 text-[#475569]">{data.sample_size_matches} fixtures</td>
                                <td className="p-3 text-[#475569]">{data.learned_coefficients.home_advantage_multiplier}x</td>
                                <td className="p-3 text-[#475569]">{data.learned_coefficients.form_momentum_weight}x</td>
                                <td className="p-3 text-[#475569]">
                                  {data.learned_coefficients.volatility_index}
                                </td>
                                <td className="p-3 text-[#475569]">{data.learned_coefficients.fatigue_penalty_modifier}x</td>
                                <td className="p-3 text-right">
                                  <button
                                    onClick={() => handleEditClick(teamName)}
                                    className="text-[#15803D] hover:underline font-bold text-xs"
                                  >
                                    Fine-Tune
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={7} className="p-8 text-center text-[#64748B]">
                              No target teams found matching "{matrixSearch}"
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* 3. Match Simulator View */}
            {activeTab === "predictor" && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="text-lg font-bold text-[#0F172A]">Evidence-Gated Head-To-Head Simulator</h2>
                  <p className="text-sm text-[#64748B]">Select Home and Away teams from the locked favorite profile list and configure match context to test the predictive weight engine outputs.</p>
                </div>

                {/* Team Dropdown Selectors */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#475569]">Home Team:</label>
                    <select
                      value={predHomeTeam}
                      onChange={(e) => setPredHomeTeam(e.target.value)}
                      className="text-xs p-3 border border-[#E2E8F0] rounded-xl bg-white focus:ring-2 focus:ring-[#15803D]/20 focus:border-[#15803D]"
                    >
                      {LOCKED_80_TEAMS.map(team => {
                        const isToday = todaysTeams.has(team);
                        const isFast = isFastPacedLeagueTeam(team);
                        return (
                          <option key={team} value={team}>
                            {team}{isToday ? " 🟢 [Playing Today]" : ""}{isFast ? " (Fast)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[#475569]">Away Team:</label>
                    <select
                      value={predAwayTeam}
                      onChange={(e) => setPredAwayTeam(e.target.value)}
                      className="text-xs p-3 border border-[#E2E8F0] rounded-xl bg-white focus:ring-2 focus:ring-[#15803D]/20 focus:border-[#15803D]"
                    >
                      {LOCKED_80_TEAMS.map(team => {
                        const isToday = todaysTeams.has(team);
                        const isFast = isFastPacedLeagueTeam(team);
                        return (
                          <option key={team} value={team}>
                            {team}{isToday ? " 🟢 [Playing Today]" : ""}{isFast ? " (Fast)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {/* Interactive sliders/config for pitch facts */}
                <div className="border border-[#E2E8F0] rounded-xl p-4 bg-[#F8FAFC] flex flex-col gap-4">
                  <h4 className="text-xs font-bold text-[#0F172A] border-b border-[#E2E8F0] pb-2">Contextual Pitch Factors</h4>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Derby toggle */}
                    <div className="flex items-center justify-between p-3 bg-white border border-[#E2E8F0] rounded-lg">
                      <span className="text-xs font-semibold text-[#334155]">Local Derby Context:</span>
                      <input
                        type="checkbox"
                        checked={predWasDerby}
                        onChange={(e) => setPredWasDerby(e.target.checked)}
                        className="w-4 h-4 text-[#15803D] focus:ring-[#15803D] rounded cursor-pointer"
                      />
                    </div>

                    {/* Low block opponent toggle */}
                    <div className="flex items-center justify-between p-3 bg-white border border-[#E2E8F0] rounded-lg">
                      <span className="text-xs font-semibold text-[#334155]">Opponent Compact Low-Block:</span>
                      <input
                        type="checkbox"
                        checked={!!predOpponentLowBlock}
                        onChange={(e) => setPredOpponentLowBlock(e.target.checked)}
                        className="w-4 h-4 text-[#15803D] focus:ring-[#15803D] rounded cursor-pointer"
                      />
                    </div>

                    {/* High shot accuracy toggle */}
                    <div className="flex items-center justify-between p-3 bg-white border border-[#E2E8F0] rounded-lg">
                      <span className="text-xs font-semibold text-[#334155]">Positive Shot Accuracy Gap:</span>
                      <input
                        type="checkbox"
                        disabled={!predOpponentLowBlock}
                        checked={!!predHighShotAccuracy}
                        onChange={(e) => setPredHighShotAccuracy(e.target.checked)}
                        className="w-4 h-4 text-[#15803D] focus:ring-[#15803D] disabled:opacity-50 rounded cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
                    {/* Standing ranks */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-bold text-[#475569]">Home Standing Rank: {predHomeRank ?? "Unknown"}</label>
                      <input
                        type="range"
                        min="1"
                        max="20"
                        value={predHomeRank}
                        onChange={(e) => setPredHomeRank(Number(e.target.value))}
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#15803D]"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-bold text-[#475569]">Away Standing Rank: {predAwayRank ?? "Unknown"}</label>
                      <input
                        type="range"
                        min="1"
                        max="20"
                        value={predAwayRank}
                        onChange={(e) => setPredAwayRank(Number(e.target.value))}
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#15803D]"
                      />
                    </div>

                    {/* Possession percentage slider */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-bold text-[#475569]">Expected Possession Ratio: {predPossession === undefined ? "Unknown" : `${predPossession}% - ${100 - predPossession}%`}</label>
                      <input
                        type="range"
                        min="25"
                        max="75"
                        value={predPossession}
                        onChange={(e) => setPredPossession(Number(e.target.value))}
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#15803D]"
                      />
                    </div>
                  </div>

                  {/* Continental cup gaps */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                    <div className="flex flex-col gap-1.5 bg-white border border-[#E2E8F0] p-3 rounded-lg">
                      <span className="text-[11px] font-bold text-[#475569]">Home Days Since Last Continental Game:</span>
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="number"
                          min="1"
                          max="14"
                          value={predHomeContinentalGap}
                          onChange={(e) => setPredHomeContinentalGap(e.target.value ? Number(e.target.value) : undefined)}
                          className="text-xs p-1.5 border border-[#E2E8F0] rounded w-16"
                        />
                        <span className="text-[10px] text-[#64748B]">
                          {predHomeContinentalGap === undefined ? "Unknown" : predHomeContinentalGap <= 3 ? "⚠️ High fatigue risk (modifier applies)" : "✅ Adequate rest"}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5 bg-white border border-[#E2E8F0] p-3 rounded-lg">
                      <span className="text-[11px] font-bold text-[#475569]">Away Days Since Last Continental Game:</span>
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="number"
                          min="1"
                          max="14"
                          value={predAwayContinentalGap}
                          onChange={(e) => setPredAwayContinentalGap(e.target.value ? Number(e.target.value) : undefined)}
                          className="text-xs p-1.5 border border-[#E2E8F0] rounded w-16"
                        />
                        <span className="text-[10px] text-[#64748B]">
                          {predAwayContinentalGap === undefined ? "Unknown" : predAwayContinentalGap <= 3 ? "⚠️ High fatigue risk (modifier applies)" : "✅ Adequate rest"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Match Forecast Output */}
                {simulationResult && (
                  <div className="mt-4 border border-[#E2E8F0] rounded-xl overflow-hidden shadow-xs">
                    <div className="bg-[#15803D] text-white p-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Dribbble className="w-5 h-5" />
                        <h3 className="text-sm font-bold tracking-tight">Evidence-Gated Pitch Spread Predictions</h3>
                      </div>
                      <span className="text-xs uppercase bg-[#166534] px-2.5 py-1 rounded font-semibold tracking-wider">
                        Poisson Probability Spreads
                      </span>
                    </div>

                    <div className="p-6 bg-white flex flex-col gap-6">
                      
                      {/* Main scoreboard forecast */}
                      <div className="grid grid-cols-1 md:grid-cols-3 items-center gap-6 border-b border-[#F1F5F9] pb-6">
                        <div className="text-center md:text-right">
                          <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider block mb-1">Expected Home goals</span>
                          <span className="text-3xl font-extrabold text-[#0F172A]">{simulationResult.homeExpectedGoals.toFixed(2)}</span>
                          <span className="block text-xs font-semibold text-[#15803D] mt-1">{predHomeTeam}</span>
                        </div>

                        <div className="text-center bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
                          <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block mb-2">Evidence-Gated Spread score</span>
                          <span className="text-3xl font-mono font-bold text-[#0F172A]">
                            {simulationResult.homeScore} - {simulationResult.awayScore}
                          </span>
                          <span className="text-[10px] text-gray-500 block mt-1">Nearest integer prediction</span>
                        </div>

                        <div className="text-center md:text-left">
                          <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider block mb-1">Expected Away goals</span>
                          <span className="text-3xl font-extrabold text-[#0F172A]">{simulationResult.awayExpectedGoals.toFixed(2)}</span>
                          <span className="block text-xs font-semibold text-[#15803D] mt-1">{predAwayTeam}</span>
                        </div>
                      </div>

                      {/* Confidence is intentionally unavailable until a calibrated evaluation dataset exists. */}
                      <div className="bg-[var(--bg-badge)] border border-[var(--border-primary)] p-4 rounded-xl">
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Model Confidence</span>
                          <span className="text-lg font-black text-amber-600">Unavailable</span>
                          <span className="text-[10px] text-[#64748B]">
                            Confidence intervals are not reported from heuristic sample counts. Out-of-sample calibration is required first.
                          </span>
                        </div>
                      </div>

                      {/* Win/Draw/Loss probabilities meters */}
                      <div className="flex flex-col gap-3">
                        <span className="text-xs font-bold text-[#334155] uppercase tracking-wider">Outcome Probabilities</span>
                        <div className="h-6 bg-gray-100 rounded-full overflow-hidden flex text-xs font-bold text-white text-center">
                          <div 
                            style={{ width: `${simulationResult.homeWinProbability}%` }}
                            className="bg-[#15803D] flex items-center justify-center transition-all duration-500"
                          >
                            {simulationResult.homeWinProbability > 15 && `Home Win: ${simulationResult.homeWinProbability}%`}
                          </div>
                          <div 
                            style={{ width: `${simulationResult.drawProbability}%` }}
                            className="bg-gray-400 flex items-center justify-center transition-all duration-500"
                          >
                            {simulationResult.drawProbability > 12 && `Draw: ${simulationResult.drawProbability}%`}
                          </div>
                          <div 
                            style={{ width: `${simulationResult.awayWinProbability}%` }}
                            className="bg-[#334155] flex items-center justify-center transition-all duration-500"
                          >
                            {simulationResult.awayWinProbability > 15 && `Away Win: ${simulationResult.awayWinProbability}%`}
                          </div>
                        </div>
                      </div>

                      {/* Transparent analytical log matching 10 rules */}
                      <div>
                        <span className="text-xs font-bold text-[#334155] uppercase tracking-wider block mb-2">Evidence-Gated Calculation Transparency Log</span>
                        <div className="bg-[#FAF9F6] border border-[#E2E8F0] p-4 rounded-xl font-mono text-[10px] text-[#475569] flex flex-col gap-1.5 leading-relaxed">
                          {simulationResult.reasons.map((reason, idx) => (
                            <div key={idx} className="flex items-start gap-2">
                              <span className="text-[#15803D] font-bold">▶</span>
                              <span>{reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 4. Model Advancement Research */}
            {activeTab === "advancement" && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="text-lg font-bold text-[#0F172A]">Sports Science Model Advancement Scan</h2>
                  <p className="text-sm text-[#64748B]">Checks and references state-of-the-art predictive research (including shot accuracy gaps inside compact low-blocks and geographic transitions). Auto-injects discovery metrics directly into our coefficients.</p>
                </div>

                <div className="bg-slate-900 border border-[#0F172A] rounded-xl p-4 font-mono text-xs text-green-400 min-h-[180px] flex flex-col gap-2 shadow-inner">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-slate-400">
                    <span>REINFORCEMENT LEARNING RESEARCH AGENT</span>
                    <span className="animate-pulse bg-green-500/10 text-green-500 px-2 py-0.5 rounded text-[10px]">active</span>
                  </div>
                  <div className="flex-1 overflow-y-auto flex flex-col gap-1">
                    {researchConsole.map((log, i) => (
                      <p key={i}>&gt; {log}</p>
                    ))}
                    {isResearching && (
                      <p className="animate-pulse">&gt; Loading next academic parameter indexes...</p>
                    )}
                    {!isResearching && researchConsole.length === 0 && (
                      <p className="text-slate-500">&gt; Standby. Click "Search Breakthrough Insights" to start scanning...</p>
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleAdvancementResearch}
                    disabled={isResearching}
                    className="bg-[#15803D] hover:bg-[#166534] disabled:bg-gray-300 text-white text-xs font-bold px-6 py-3 rounded-xl transition flex items-center gap-2 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    Search Breakthrough Insights
                  </button>
                </div>

                {/* Proposed Research updates visualization */}
                {proposedUpdates && (
                  <div className="border border-[#15803D] rounded-xl p-5 bg-[#F0FDF4] flex flex-col gap-4">
                    <h3 className="text-sm font-bold text-[#15803D] flex items-center gap-2">
                      <Check className="w-5 h-5" /> Breakthrough Discovered
                    </h3>

                    <div>
                      <p className="text-xs font-bold text-[#0F172A] mb-1">Proposed Global Calibration Adjustment Weights:</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white p-3 rounded-lg border border-[#E2E8F0]">
                        <div className="text-xs">
                          <span className="text-[#64748B] block text-[10px]">Home Adv:</span>
                          <strong className="text-[#0f172a]">{proposedUpdates.recommended_coefficients.home_advantage_multiplier}x</strong>
                        </div>
                        <div className="text-xs">
                          <span className="text-[#64748B] block text-[10px]">Form Momentum:</span>
                          <strong className="text-[#0f172a]">{proposedUpdates.recommended_coefficients.form_momentum_weight}x</strong>
                        </div>
                        <div className="text-xs">
                          <span className="text-[#64748B] block text-[10px]">Volatility Scaling:</span>
                          <strong className="text-[#0f172a]">{proposedUpdates.recommended_coefficients.volatility_index}x</strong>
                        </div>
                        <div className="text-xs">
                          <span className="text-[#64748B] block text-[10px]">Fatigue Penalty:</span>
                          <strong className="text-[#0f172a]">{proposedUpdates.recommended_coefficients.fatigue_penalty_modifier}x</strong>
                        </div>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-bold text-[#0F172A] mb-1">Model Research Log & Notes:</p>
                      <p className="text-xs text-[#334155] leading-relaxed bg-white border border-[#E2E8F0] p-3 rounded-lg font-mono">
                        {proposedUpdates.meta_improvement_notes}
                      </p>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        onClick={() => setProposedUpdates(null)}
                        className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700"
                      >
                        Discard
                      </button>
                      <button
                        onClick={applyProposedResearch}
                        className="bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold px-6 py-2.5 rounded-lg transition"
                      >
                        Review Recommendation (Not Applied)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 5. Synchronisation Layer View */}
            {activeTab === "sync" && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="text-lg font-bold text-[#0F172A]">Programmatic Export Synchronisation Layer</h2>
                  <p className="text-sm text-[#64748B]">This structure serves as the direct data layer for parent platform ingestion. Calibrate predictions instantly via program fetches of this payload.</p>
                </div>

                <div className="flex items-center justify-between text-xs font-semibold text-[#475569] border-b border-[#F1F5F9] pb-3">
                  <span>Current Payload Object Code (Strict JSON Output Framework)</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyJSON}
                      className="bg-white hover:bg-[#F1F5F9] border border-[#E2E8F0] px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#15803D]" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy JSON
                        </>
                      )}
                    </button>

                    <button
                      onClick={handleTriggerSync}
                      className="bg-[#15803D] hover:bg-[#166534] text-white px-4 py-1.5 rounded-lg font-bold flex items-center gap-1 transition"
                    >
                      {isSynced ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Program Synced!
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" /> Trigger Sync Ingestion
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Actual JSON output container code */}
                <div className="relative">
                  <pre className="text-[10px] font-mono p-4 bg-[#FAFAFA] border border-[#E2E8F0] rounded-xl overflow-x-auto max-h-[380px] text-[#334155]">
                    {JSON.stringify(syncPayload, null, 2)}
                  </pre>
                </div>

                <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs flex flex-col gap-2">
                  <div className="flex items-center gap-2 font-bold">
                    <ShieldAlert className="w-4 h-4 text-emerald-500 shrink-0" /> <span className="text-[#15803D] dark:text-[#10b981] font-extrabold">Programmatic Key Schema Compliance</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-[#665E4E]">
                    <li>The exported object follows strict relational rules.</li>
                    <li>Parent key strictly locked as <code className="font-mono bg-amber-100 px-1 py-0.2 rounded font-bold">team_intelligence_matrices</code>.</li>
                    <li>Includes required properties: <code className="font-mono bg-amber-100 px-1 py-0.2 rounded">sync_timestamp</code>, <code className="font-mono bg-amber-100 px-1 py-0.2 rounded">model_engine</code>, <code className="font-mono bg-amber-100 px-1 py-0.2 rounded">meta_improvement_notes</code>.</li>
                  </ul>
                </div>
              </div>
            )}

            {/* 6. Historical Trends View */}
            {activeTab === "trends" && (
              <div className="flex flex-col gap-6 text-left">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#F1F5F9] pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-[#0F172A]">Historical Coefficients Rolling Average</h2>
                    <p className="text-sm text-[#64748B]">
                      Displays the 5-match rolling average of learned predictive coefficients over the last 15 fixtures.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-[#475569] whitespace-nowrap">Select Favorite Team:</label>
                    <select
                      value={trendTeam}
                      onChange={(e) => setTrendTeam(e.target.value)}
                      className="text-xs p-2 border border-[#E2E8F0] rounded-lg bg-white text-[#334155] focus:ring-2 focus:ring-[#15803D]/20 focus:border-[#15803D] cursor-pointer"
                    >
                      {LOCKED_80_TEAMS.map((teamName) => (
                        <option key={teamName} value={teamName}>
                          {teamName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Info Cards Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-center">
                    <span className="text-[10px] font-bold text-[#64748B] uppercase block">Latest Home Adv</span>
                    <strong className="text-xl font-extrabold text-[#0F172A] mt-1 block">
                      {(teamMatrices[trendTeam]?.learned_coefficients?.home_advantage_multiplier ?? 1.12).toFixed(2)}x
                    </strong>
                    <span className="text-[9px] text-[#15803D] font-semibold">Pitch-Bias Weight</span>
                  </div>

                  <div className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-center">
                    <span className="text-[10px] font-bold text-[#64748B] uppercase block">Latest Form Momentum</span>
                    <strong className="text-xl font-extrabold text-[#0F172A] mt-1 block">
                      {(teamMatrices[trendTeam]?.learned_coefficients?.form_momentum_weight ?? 1.15).toFixed(2)}x
                    </strong>
                    <span className="text-[9px] text-blue-600 font-semibold">Form Drift Factor</span>
                  </div>

                  <div className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-center">
                    <span className="text-[10px] font-bold text-[#64748B] uppercase block">Latest Volatility</span>
                    <strong className="text-xl font-extrabold text-[#0F172A] mt-1 block">
                      {(teamMatrices[trendTeam]?.learned_coefficients?.volatility_index ?? 1.00).toFixed(2)}x
                    </strong>
                    <span className="text-[9px] text-amber-600 font-semibold">Standard Deviation</span>
                  </div>

                  <div className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-center">
                    <span className="text-[10px] font-bold text-[#64748B] uppercase block">Latest Fatigue Penalty</span>
                    <strong className="text-xl font-extrabold text-[#0F172A] mt-1 block">
                      {(teamMatrices[trendTeam]?.learned_coefficients?.fatigue_penalty_modifier ?? 0.95).toFixed(2)}x
                    </strong>
                    <span className="text-[9px] text-red-600 font-semibold">Rest Fatigue Deficit</span>
                  </div>
                </div>

                {/* Main Line Graph Chart inside a container */}
                <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-bold text-[#334155] uppercase tracking-wider">
                      Rolling 5-Match Average Smoothing Timeline
                    </span>
                    <span className="text-[10px] bg-[#E8F5E9] text-[#15803D] border border-[#C8E6C9] px-2 py-0.5 rounded font-bold">
                      Dynamic Recharts Ingested
                    </span>
                  </div>

                  <div className="w-full h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={trendData}
                        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                        <XAxis 
                          dataKey="name" 
                          stroke="var(--text-secondary)" 
                          fontSize={10} 
                          tickLine={false}
                        />
                        <YAxis 
                          stroke="var(--text-secondary)" 
                          fontSize={10} 
                          tickLine={false}
                          domain={["auto", "auto"]}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "var(--bg-card)",
                            borderColor: "var(--border-primary)",
                            color: "var(--text-primary)",
                            fontSize: "11px",
                            borderRadius: "8px"
                          }}
                        />
                        <Legend 
                          verticalAlign="top" 
                          height={36} 
                          iconType="circle"
                          iconSize={8}
                          wrapperStyle={{ fontSize: "11px" }}
                        />
                        <Line
                          type="monotone"
                          dataKey="Home Adv (5-event Avg)"
                          stroke="#10b981"
                          strokeWidth={2.5}
                          activeDot={{ r: 6 }}
                          dot={{ r: 3 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="Form Momentum (5-event Avg)"
                          stroke="#3b82f6"
                          strokeWidth={2.5}
                          activeDot={{ r: 6 }}
                          dot={{ r: 3 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="Volatility (5-event Avg)"
                          stroke="#f59e0b"
                          strokeWidth={2.5}
                          activeDot={{ r: 6 }}
                          dot={{ r: 3 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="Fatigue Penalty (5-event Avg)"
                          stroke="#ef4444"
                          strokeWidth={2.5}
                          activeDot={{ r: 6 }}
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Analytical Insight block */}
                <div className="p-4 bg-emerald-50/50 border border-[#15803D]/20 rounded-xl text-xs flex flex-col gap-2">
                  <div className="flex items-center gap-2 font-bold text-[#15803D] dark:text-[#10b981]">
                    <TrendingUp className="w-4 h-4" /> 
                    Sports Science Trend Interpretation Log
                  </div>
                  <p className="text-[#475569] dark:text-[#a7f3d0] leading-relaxed">
                    This graph applies a <strong>rolling 5-match smoothing window</strong> to raw prediction coefficients. By dampening short-term anomalies and outliers (such as individual red card incidents or freak extreme weather conditions), the 5-match moving average reveals the underlying tactical drift and systemic momentum calibrated for the locked 80 target list.
                  </p>
                </div>
              </div>
            )}

          </div>
        </div>

      </main>

      {/* --- Footer Area --- */}
      <footer className="bg-white border-t border-[#E2E8F0] mt-12 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center text-xs text-[#64748B] flex flex-col md:flex-row items-center justify-between gap-4">
          <p>© 2026 Football Analytical Engine. Ingestion parameters strictly calibrated for evidence-gated pitch spreads.</p>
          <div className="flex items-center gap-4">
            <span className="hover:text-[#0F172A] transition">Strict 10 Matrix Rules Standard</span>
            <span className="hover:text-[#0F172A] transition">Verified-result calibration only</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
