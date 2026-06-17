import type { MatchData } from '../types/odds';

const SINGAPORE_TIME_ZONE = 'Asia/Singapore';
const DATE_TIME_PATTERN = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/;
const MONTH_DAY_PATTERN = /(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;

export interface MatchScheduleGroup {
  key: string;
  label: string;
  matches: MatchData[];
  unscheduled: boolean;
}

interface ParsedSchedule {
  dateKey: string;
  sortValue: number;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function dateSortValue(year: number, month: number, day: number, hour = 0, minute = 0) {
  return Date.UTC(year, month - 1, day, hour, minute);
}

function singaporeDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SINGAPORE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
  };
}

function currentSingaporeYear() {
  return singaporeDateParts(new Date()).year;
}

function todaySingaporeKey() {
  const now = singaporeDateParts(new Date());
  return dateKey(now.year, now.month, now.day);
}

function singaporeDateKeyWithOffset(dayOffset: number) {
  const now = singaporeDateParts(new Date());
  const shifted = new Date(Date.UTC(now.year, now.month - 1, now.day + dayOffset));
  return dateKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function parseWithTimezone(value: string): ParsedSchedule | null {
  if (!/(?:z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = singaporeDateParts(date);
  return {
    dateKey: dateKey(parts.year, parts.month, parts.day),
    sortValue: dateSortValue(parts.year, parts.month, parts.day, parts.hour, parts.minute),
  };
}

function parseDateTime(value: string, fallbackYear = currentSingaporeYear()): ParsedSchedule | null {
  const zoned = parseWithTimezone(value);
  if (zoned) return zoned;

  const fullMatch = value.match(DATE_TIME_PATTERN);
  if (fullMatch) {
    const year = Number(fullMatch[1]);
    const month = Number(fullMatch[2]);
    const day = Number(fullMatch[3]);
    const hour = Number(fullMatch[4] ?? 0);
    const minute = Number(fullMatch[5] ?? 0);
    return {
      dateKey: dateKey(year, month, day),
      sortValue: dateSortValue(year, month, day, hour, minute),
    };
  }

  const monthDayMatch = value.match(MONTH_DAY_PATTERN);
  if (monthDayMatch) {
    const month = Number(monthDayMatch[1]);
    const day = Number(monthDayMatch[2]);
    const hour = Number(monthDayMatch[3]);
    const minute = Number(monthDayMatch[4]);
    return {
      dateKey: dateKey(fallbackYear, month, day),
      sortValue: dateSortValue(fallbackYear, month, day, hour, minute),
    };
  }

  return null;
}

export function parseMatchSchedule(match: MatchData): ParsedSchedule | null {
  if (match.scheduledAt) {
    const parsed = parseDateTime(match.scheduledAt);
    if (parsed) return parsed;
  }

  if (/数据更新/.test(match.matchTime)) return null;
  return parseDateTime(match.matchTime);
}

export function filterMatchesByScheduleWindow(matches: MatchData[], days = 2): MatchData[] {
  const allowedKeys = new Set(Array.from({ length: days }, (_, index) => singaporeDateKeyWithOffset(index)));
  return matches.filter((match) => {
    const schedule = parseMatchSchedule(match);
    return schedule ? allowedKeys.has(schedule.dateKey) : false;
  });
}

export function filterMatchesForDashboard(matches: MatchData[], days = 2): MatchData[] {
  const allowedKeys = new Set(Array.from({ length: days }, (_, index) => singaporeDateKeyWithOffset(index)));
  return matches.filter((match) => {
    if (match.sourceType === 'manual') return true;
    const schedule = parseMatchSchedule(match);
    return schedule ? allowedKeys.has(schedule.dateKey) : false;
  });
}

function groupLabel(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  const today = todaySingaporeKey();
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
  const dayOffset =
    (dateSortValue(year, month, day) - dateSortValue(todayYear, todayMonth, todayDay)) / 86_400_000;
  const dateText = `${pad2(month)}月${pad2(day)}日`;

  if (dayOffset === 0) return `今天 · ${dateText}`;
  if (dayOffset === 1) return `明天 · ${dateText}`;
  if (dayOffset === 2) return `后天 · ${dateText}`;
  if (dayOffset < 0) return `已过期 · ${dateText}`;
  return dateText;
}

export function groupMatchesBySchedule(matches: MatchData[]): MatchScheduleGroup[] {
  const scheduled = matches
    .map((match) => ({ match, schedule: parseMatchSchedule(match) }))
    .sort((left, right) => {
      if (left.schedule && right.schedule) {
        return left.schedule.sortValue - right.schedule.sortValue || left.match.name.localeCompare(right.match.name);
      }
      if (left.schedule) return -1;
      if (right.schedule) return 1;
      return left.match.name.localeCompare(right.match.name);
    });

  const grouped = new Map<string, MatchData[]>();
  const unscheduled: MatchData[] = [];

  scheduled.forEach(({ match, schedule }) => {
    if (!schedule) {
      unscheduled.push(match);
      return;
    }
    grouped.set(schedule.dateKey, [...(grouped.get(schedule.dateKey) ?? []), match]);
  });

  const groups = Array.from(grouped.entries()).map(([key, groupMatches]) => ({
    key,
    label: groupLabel(key),
    matches: groupMatches,
    unscheduled: false,
  }));

  if (unscheduled.length > 0) {
    groups.push({
      key: 'unscheduled',
      label: '时间待确认',
      matches: unscheduled,
      unscheduled: true,
    });
  }

  return groups;
}
