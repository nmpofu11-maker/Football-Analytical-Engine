/**
 * Dynamic date utility functions to eliminate hardcoded date cutoffs
 * and provide rolling 48-hour historical windows and dynamic slate selection.
 */

// Returns today's calendar date in YYYY-MM-DD in local time
export function getTodayDateStr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Returns the rolling 48-hour cutoff timestamp in YYYY-MM-DD
export function get48HourRollingCutoff(): string {
  const d = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Formats an ISO YYYY-MM-DD date into human-readable string (e.g., "Sep 25, 2026")
export function formatDateHuman(isoDate: string): string {
  if (!isoDate || isoDate === "all") return "All Matches";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const dateObj = new Date(year, month, day);
  return dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Returns dynamic quick-pick date options starting from Today (0), Tomorrow (+1), up to +4 days
export interface DatePickOption {
  dateStr: string;
  label: string;
  shortLabel: string;
  isToday: boolean;
  isTomorrow: boolean;
}

export function getDynamicDatePickers(daysAhead = 4): DatePickOption[] {
  const options: DatePickOption[] = [];
  const today = new Date();

  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    const monthName = d.toLocaleDateString("en-US", { month: "short" });
    const dayNum = d.getDate();

    if (i === 0) {
      options.push({
        dateStr,
        label: `🟢 ${monthName} ${dayNum} (Today)`,
        shortLabel: "Today",
        isToday: true,
        isTomorrow: false
      });
    } else if (i === 1) {
      options.push({
        dateStr,
        label: `${monthName} ${dayNum} (Tomorrow)`,
        shortLabel: "Tomorrow",
        isToday: false,
        isTomorrow: true
      });
    } else {
      options.push({
        dateStr,
        label: `${monthName} ${dayNum}`,
        shortLabel: `${monthName} ${dayNum}`,
        isToday: false,
        isTomorrow: false
      });
    }
  }

  return options;
}
