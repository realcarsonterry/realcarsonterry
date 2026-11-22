import { readFile, rename, rm, writeFile } from 'node:fs/promises';

const calendarUrl = 'https://github.com/users/realcarsonterry/contributions';
const dateFormat = new Intl.DateTimeFormat('en', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });
const numberFormat = new Intl.NumberFormat('en-US');
const dayInMs = 86_400_000;
const colors = ['#202b3d', '#214867', '#297aab', '#57b8e4', '#a1edf8'];

function attribute(tag, name) {
  return tag.match(new RegExp('\\s' + name + '="([^"]+)"', 'i'))?.[1];
}

function parseCalendar(html) {
  const counts = new Map();
  for (const [, tag, text] of html.matchAll(/(<tool-tip\b[^>]*>)([^<]+)<\/tool-tip>/gi)) {
    const target = attribute(tag, 'for');
    if (!target?.startsWith('contribution-day-component-')) continue;

    const count = text.trim().match(/^(No|[\d,]+)\s+contributions?\s+on\b/i)?.[1];
    if (count === undefined || counts.has(target)) {
      throw new Error('GitHub returned a missing or duplicate daily contribution count');
    }
    counts.set(target, count.toLowerCase() === 'no' ? 0 : Number(count.replaceAll(',', '')));
  }

  const days = [];
  for (const [tag] of html.matchAll(/<td\b[^>]*>/gi)) {
    const id = attribute(tag, 'id');
    if (!id?.startsWith('contribution-day-component-')) continue;

    const date = attribute(tag, 'data-date');
    const level = attribute(tag, 'data-level');
    const count = counts.get(id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !/^[0-4]$/.test(level ?? '') ||
        !Number.isSafeInteger(count) || (level === '0') !== (count === 0)) {
      throw new Error('GitHub returned an invalid contribution calendar cell');
    }
    days.push({ date, level: Number(level), count, timestamp: Date.parse(date) });
  }

  days.sort((a, b) => a.timestamp - b.timestamp);
  if (days.length < 365 || days.length > 367 ||
      days.some((day, index) => !Number.isFinite(day.timestamp) ||
        (index > 0 && day.timestamp - days[index - 1].timestamp !== dayInMs))) {
    throw new Error('GitHub returned an incomplete one-year contribution calendar');
  }
  const latest = days.at(-1).timestamp;
  if (Date.now() - latest > 4 * dayInMs || latest - Date.now() >= dayInMs) {
    throw new Error('GitHub returned a contribution calendar outside the expected date range');
  }
  return days;
}

function renderCalendar(days, compact) {
  const first = days[0];
  const last = days.at(-1);
  const startOfWeek = first.timestamp - new Date(first.timestamp).getUTCDay() * dayInMs;
  const total = numberFormat.format(days.reduce((sum, day) => sum + day.count, 0));
  const activeDays = numberFormat.format(days.filter((day) => day.count > 0).length);
  const period = dateFormat.format(first.timestamp) + ' – ' + dateFormat.format(last.timestamp);
  const layout = compact
    ? { width: 560, height: 382, columns: 27, x: 51, dx: 18.1, dy: 12, cellWidth: 14.3, cellHeight: 9.5 }
    : { width: 900, height: 282, columns: 54, x: 84, dx: 14.42, dy: 13.7, cellWidth: 11.7, cellHeight: 10.8 };
  const rows = compact ? [138, 252] : [126];
  const months = [];
  const cells = [];
  const pulse = [];
  let lastLabel = -2;

  for (const day of days) {
    const date = new Date(day.timestamp);
    const week = Math.floor((day.timestamp - startOfWeek) / (7 * dayInMs));
    const column = week % layout.columns;
    const row = rows[Math.floor(week / layout.columns)];
    const x = layout.x + column * layout.dx;
    const y = row + date.getUTCDay() * layout.dy;
    if ((date.getUTCDate() === 1 || day === first) && week - lastLabel >= 3 &&
        column < layout.columns - 2) {
      months.push('<text x="' + x.toFixed(2) + '" y="' + (row - 11) + '">' + monthFormat.format(date) + '</text>');
      lastLabel = week;
    }
    cells.push('<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) +
      '" width="' + layout.cellWidth + '" height="' + layout.cellHeight + '" rx="2.3" fill="' + colors[day.level] + '">' +
      '<title>' + day.date + ' · ' + day.count + '</title></rect>');
    if (day.count > 0) {
      const begin = (week * 0.073 + 0.32).toFixed(3);
      pulse.push('<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) +
        '" width="' + layout.cellWidth + '" height="' + layout.cellHeight +
        '" rx="2.3" fill="#c8fcff" fill-opacity=".88" opacity="0">' +
        '<animate attributeName="opacity" values="0;1;0" keyTimes="0;.28;1" begin="' +
        begin + 's" dur=".62s"/></rect>');
    }
  }

  const margin = compact ? 22 : 37;
  const right = layout.width - margin;
  const legendY = layout.height - 33;
  const legendX = right - 142;
  const dateY = compact ? 99 : 61;
  const separators = compact ? [111, 234, 339] : [88, 229];
  const divider = separators.map((y) => 'M' + margin + ' ' + y + 'H' + right).join('');
  const legend = colors.map((color, index) =>
    '<rect x="' + (legendX + index * 17) + '" y="' + (legendY - 10) +
    '" width="13" height="12" rx="2.4" fill="' + color + '"/>');
  const weekdays = rows.flatMap((row) => ['Mon', 'Wed', 'Fri'].map((day, index) =>
    '<text x="' + margin + '" y="' + Math.round(row + (1 + 2 * index) * layout.dy + 9) + '">' +
    day + '</text>'));
  const anchors = [' viewBox="0 0 ' + layout.width + ' ' + layout.height + '"',
    ' width="' + layout.width + '" height="' + layout.height + '"'].join('');

  return [
    '<svg xmlns="http://www.w3.org/2000/svg"' + anchors + ' role="img" aria-labelledby="title desc">',
    '  <title id="title">GitHub contribution calendar</title>',
    '  <desc id="desc">' + total + ' contributions on ' + activeDays + ' active days. ' + period + '. Each cell represents a day.</desc>',
    '  <defs><linearGradient id="surface" x2="1" y2="1"><stop stop-color="#101923"/><stop offset="1" stop-color="#16182b"/></linearGradient></defs>',
    '  <rect x="1" y="1" width="' + (layout.width - 2) + '" height="' + (layout.height - 2) +
      '" rx="15" fill="url(#surface)" stroke="#344459" stroke-width="1.5"/>',
    '  <path d="' + divider + '" stroke="#303f55"/>',
    '  <g font-family="Arial, Helvetica, sans-serif">',
    '    <text x="' + margin + '" y="54" fill="#edfaff" font-size="34" font-weight="700">' + total + '</text>',
    '    <text x="' + margin + '" y="73" fill="#b2c8da" font-size="16">Contributions</text>',
    '    <text x="' + (compact ? 178 : 238) + '" y="54" fill="#9bdeff" font-size="34" font-weight="700">' + activeDays + '</text>',
    '    <text x="' + (compact ? 178 : 238) + '" y="73" fill="#b2c8da" font-size="16">Active days</text>',
    '    <text x="' + (compact ? margin : right) + '" y="' + dateY + '"' + (compact ? '' : ' text-anchor="end"') +
      ' fill="#c5d3e3" font-size="17">' + period + '</text>',
    '  </g>',
    '  <g font-family="Consolas, Liberation Mono, monospace" font-size="14" fill="#afc4da">',
    ...weekdays.map((item) => '    ' + item),
    ...months.map((item) => '    ' + item),
    '    <text x="' + margin + '" y="' + legendY + '">GITHUB CONTRIBUTION CALENDAR</text>',
    '    <text x="' + (legendX - 9) + '" y="' + legendY + '" text-anchor="end">Less</text>',
    '    <text x="' + (legendX + 92) + '" y="' + legendY + '">More</text>',
    '  </g>',
    ...cells.map((item) => '  ' + item),
    '  <g class="motion" aria-hidden="true">',
    ...rows.map((row, index) => {
      const start = (index * layout.columns * 0.073 + 0.32).toFixed(3);
      const distance = (layout.columns - 1) * layout.dx;
      const duration = ((layout.columns - 1) * 0.073).toFixed(3);
      const x = layout.x + layout.cellWidth / 2;
      return '    <path d="M' + x + ' ' + (row - 4) + 'v' + (layout.dy * 6 + layout.cellHeight + 8) +
        '" stroke="#75f0fb" stroke-width="1.5" opacity="0">' +
        '<animateTransform attributeName="transform" type="translate" from="0 0" to="' + distance +
        ' 0" begin="' + start + 's" dur="' + duration + 's"/>' +
        '<animate attributeName="opacity" values="0;.64;.64;0" keyTimes="0;.07;.93;1" begin="' +
        start + 's" dur="' + duration + 's"/></path>';
    }),
    ...pulse.map((item) => '    ' + item),
    '  </g>',
    '  <style>@media (prefers-reduced-motion: reduce) { .motion { display: none; } }</style>',
    '  ' + legend.join(''),
    '</svg>',
    '',
  ].join('\n');
}

async function saveChart(filename, svg) {
  const outputUrl = new URL('../assets/' + filename, import.meta.url);
  const previous = await readFile(outputUrl, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (previous === svg) return;

  const temporary = new URL(filename + '.' + process.pid + '.tmp', outputUrl);
  try {
    await writeFile(temporary, svg, { flag: 'wx' });
    await rename(temporary, outputUrl);
  } finally {
    await rm(temporary, { force: true });
  }
}

const response = await fetch(calendarUrl, {
  headers: { accept: 'text/html' },
  signal: AbortSignal.timeout(25_000),
});
if (!response.ok) {
  throw new Error('GitHub contribution calendar responded with HTTP ' + response.status);
}
const days = parseCalendar(await response.text());
await saveChart('activity.svg', renderCalendar(days, false));
await saveChart('activity-compact.svg', renderCalendar(days, true));
