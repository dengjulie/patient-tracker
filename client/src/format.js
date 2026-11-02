// Display helpers. Birth dates arrive as 'YYYY-MM-DD' strings and are handled
// as plain numbers, never JavaScript Dates, so time zones can't shift them.

// Badge colour for each status, in the list and the patient view.
export const STATUS_COLORS = {
  planned: 'blue',
  waitlist: 'yellow',
  active: 'green',
  onhold: 'orange',
  finished: 'gray',
  cancelled: 'red',
};

// "Robert James Okafor Jr. (Bobby)"
export function displayName(patient) {
  const { name, preferredName } = patient;
  return preferredName ? `${name.text} (${preferredName})` : name.text;
}

// "Austin, TX", from whichever parts are filled in: every address part is
// optional, for patients without a fixed address.
export function cityState({ city, state }) {
  return [city, state].filter(Boolean).join(', ');
}

// '1984-03-12' -> '03/12/1984'
export function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${month}/${day}/${year}`;
}

// When a record changed. Unlike birth dates, this is a moment in time, so a
// Date is right here. Recent changes read as relative time ("3 hours ago");
// after a week, a plain date is more useful.
const relativeTime = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatUpdated(timestamp, now = new Date()) {
  const elapsed = now - new Date(timestamp);
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return relativeTime.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relativeTime.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < 7 * DAY) return relativeTime.format(-Math.floor(elapsed / DAY), 'day');
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Full date and time, for the hover text.
export function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// Whole years between the birth date and today.
export function age(isoDate, today = new Date()) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const hadBirthdayThisYear =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  return today.getFullYear() - year - (hadBirthdayThisYear ? 0 : 1);
}
