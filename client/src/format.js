// Display helpers. Birth dates arrive as 'YYYY-MM-DD' strings and are handled
// as plain numbers, never JavaScript Dates, so time zones can't shift them.

// "Robert James Okafor Jr. (Bobby)"
export function displayName(patient) {
  const { name, preferredName } = patient;
  return preferredName ? `${name.text} (${preferredName})` : name.text;
}

// '1984-03-12' -> '03/12/1984'
export function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${month}/${day}/${year}`;
}

// Whole years between the birth date and today.
export function age(isoDate, today = new Date()) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const hadBirthdayThisYear =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  return today.getFullYear() - year - (hadBirthdayThisYear ? 0 : 1);
}
