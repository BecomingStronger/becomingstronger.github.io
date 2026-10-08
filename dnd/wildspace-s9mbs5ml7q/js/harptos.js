// The Calendar of Harptos (Forgotten Realms): twelve months of 30 days, five festival days,
// and Shieldmeet after Midsummer in every fourth year. Day 0 of the orrery clock is 1 Hammer
// of the epoch year, so every orbit is a function of one number: days since the epoch.

export const EPOCH_YEAR = 1492;
export const MONTHS = ["Hammer", "Alturiak", "Ches", "Tarsakh", "Mirtul", "Kythorn", "Flamerule", "Eleasis", "Eleint", "Marpenoth", "Uktar", "Nightal"];
const FESTIVAL_AFTER = { 0: "Midwinter", 3: "Greengrass", 6: "Midsummer", 8: "Highharvestide", 10: "The Feast of the Moon" };

export const isLeap = (year) => year % 4 === 0;
export const yearLength = (year) => (isLeap(year) ? 366 : 365);

// Every day of one year, in order: { month, day } or { festival }.
const tableCache = new Map();
export function yearTable(year) {
  const leap = isLeap(year);
  if (tableCache.has(leap)) return tableCache.get(leap);
  const rows = [];
  MONTHS.forEach((_, m) => {
    for (let d = 1; d <= 30; d++) rows.push({ month: m, day: d });
    if (FESTIVAL_AFTER[m]) rows.push({ festival: FESTIVAL_AFTER[m] });
    if (m === 6 && leap) rows.push({ festival: "Shieldmeet" });
  });
  tableCache.set(leap, rows);
  return rows;
}

// Absolute day (0 = 1 Hammer EPOCH_YEAR) from a year and 1-based day of year.
export function dayFromYearDoy(year, doy) {
  let n = doy - 1;
  if (year >= EPOCH_YEAR) for (let y = EPOCH_YEAR; y < year; y++) n += yearLength(y);
  else for (let y = year; y < EPOCH_YEAR; y++) n -= yearLength(y);
  return n;
}

export function yearDoyFromDay(day) {
  let n = Math.floor(day), year = EPOCH_YEAR;
  while (n < 0) { year--; n += yearLength(year); }
  while (n >= yearLength(year)) { n -= yearLength(year); year++; }
  return { year, doy: n + 1 };
}

export function formatDay(day) {
  const { year, doy } = yearDoyFromDay(day);
  const row = yearTable(year)[doy - 1];
  return row.festival ? `${row.festival} ${year} DR` : `${row.day} ${MONTHS[row.month]} ${year} DR`;
}

// For the date picker: the 1-based day of year for a month and day, or for a festival name.
export function doyOf(year, monthOrFestival, day = 1) {
  const rows = yearTable(year);
  const i = typeof monthOrFestival === "number"
    ? rows.findIndex((r) => r.month === monthOrFestival && r.day === day)
    : rows.findIndex((r) => r.festival === monthOrFestival);
  return i < 0 ? 1 : i + 1;
}

export function festivals(year) {
  return yearTable(year).filter((r) => r.festival).map((r) => r.festival);
}
