import { recordAudit } from './db.js';

// Records an audit entry for this request: the logged-in user and their IP
// address, plus the action and which patients it touched. Pass `db` to write
// it inside a transaction (see db.js).
export function audit(req, action, { patientIds, userId, attemptedEmail } = {}, db) {
  return recordAudit(
    {
      userId: userId ?? req.session.user?.id ?? null,
      action,
      patientIds,
      attemptedEmail,
      ipAddress: req.ip,
    },
    db
  );
}
