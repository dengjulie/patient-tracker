// Shows the audit log in the terminal (PRODUCT.md §7), newest first. It's PHI
// too: it links patients to who looked at them, so treat the output like
// patient data.
//
//   npm run audit                                 latest 50 entries
//   npm run audit -- --patient 42                 who saw or changed patient 42
//   npm run audit -- --user demo@example.com      what one provider did
//   npm run audit -- --practice "Demo Practice"   one practice's log
//   npm run audit -- --action login_failed        e.g. failed logins
//   npm run audit -- --since 2026-11-01 --limit 200
//
// Filters combine. Uses the owner login, so it sees every practice.
import { parseArgs } from 'node:util';
import { listAuditEntries, closePools, AUDIT_ACTIONS } from './db.js';

const USAGE = `Usage: npm run audit -- [--patient <id>] [--user <email>] [--practice <name>]
                          [--action <${AUDIT_ACTIONS.join('|')}>] [--since <YYYY-MM-DD>] [--limit <n>]`;

let options;
try {
  ({ values: options } = parseArgs({
    options: {
      patient: { type: 'string' },
      user: { type: 'string' },
      practice: { type: 'string' },
      action: { type: 'string' },
      since: { type: 'string' },
      limit: { type: 'string', default: '50' },
      help: { type: 'boolean', short: 'h' },
    },
  }));
} catch (err) {
  console.error(`${err.message}\n${USAGE}`);
  process.exit(1);
}

const problems = [
  options.patient && !/^\d+$/.test(options.patient) && '--patient must be a patient id (a number)',
  options.action && !AUDIT_ACTIONS.includes(options.action) && `--action must be one of: ${AUDIT_ACTIONS.join(', ')}`,
  options.since && !/^\d{4}-\d{2}-\d{2}$/.test(options.since) && '--since must be a date like 2026-11-01',
  !/^\d+$/.test(options.limit) && '--limit must be a number',
].filter(Boolean);
if (options.help || problems.length) {
  console.error([...problems, USAGE].join('\n'));
  process.exit(options.help ? 0 : 1);
}

const entries = await listAuditEntries({
  patientId: options.patient && Number(options.patient),
  email: options.user,
  practice: options.practice,
  action: options.action,
  since: options.since,
  limit: Number(options.limit),
});
await closePools();

// A search can show 25 patients; list the first few so rows stay readable.
const MAX_IDS_SHOWN = 6;
const patients = (ids) =>
  ids.length <= MAX_IDS_SHOWN ? ids.join(', ') : `${ids.slice(0, MAX_IDS_SHOWN).join(', ')} … (+${ids.length - MAX_IDS_SHOWN})`;

if (!entries.length) {
  console.log('No audit entries match.');
} else {
  console.table(
    entries.map((e) => ({
      when: e.occurred_at.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' }),
      practice: e.practice ?? '',
      user: e.email ?? '',
      action: e.action,
      patients: patients(e.patient_ids),
      ip: e.ip_address ?? '',
    }))
  );
  console.log(`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, newest first.`);
}
