// Russian formatting of times, durations and token counts.
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const pad = (n) => String(n).padStart(2, "0");
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a, b) => a.toDateString() === b.toDateString();

// "00:52" today, "ср 09:35" within a week, "4 ноя 09:35" further away.
function when(ts, now = Date.now()) {
  if (!ts) return "—";
  const d = new Date(ts), n = new Date(now);
  if (sameDay(d, n)) return hm(d);
  if (sameDay(d, new Date(now - 864e5))) return `вчера ${hm(d)}`;
  if (sameDay(d, new Date(now + 864e5))) return `завтра ${hm(d)}`;
  if (Math.abs(ts - now) < 6 * 864e5) return `${WEEKDAYS[d.getDay()]} ${hm(d)}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${hm(d)}`;
}

// "через 2 ч 4 мин", "через 2 д 11 ч", "через 15 мин".
function until(ts, now = Date.now()) {
  if (!ts) return "";
  const min = Math.max(0, Math.round((ts - now) / 6e4));
  if (min < 60) return `через ${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `через ${h} ч ${min % 60} мин`;
  return `через ${Math.floor(h / 24)} д ${h % 24} ч`;
}

// "только что", "12 мин назад", "3 ч назад", then a date.
function ago(ts, now = Date.now()) {
  if (!ts) return "";
  const min = Math.max(0, Math.round((now - ts) / 6e4));
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} ч назад`;
  return when(ts, now);
}

function date(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function tokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} млн`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("ru-RU")} тыс.`;
  return String(n);
}

module.exports = { when, until, ago, date, tokens, MONTHS };
