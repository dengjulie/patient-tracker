import { recordAudit } from './db.js';

// Records an audit entry for this request: the logged-in user, their
// practice and IP address, plus the action and which patients it touched.
// Pass `db` to write it inside a transaction (see db.js).
export function audit(req, action, { patientIds, userId, practiceId, attemptedEmail } = {}, db) {
  return recordAudit(
    {
      practiceId: practiceId ?? req.session.user?.practiceId ?? null,
      userId: userId ?? req.session.user?.id ?? null,
      action,
      patientIds,
      attemptedEmail,
      ipAddress: req.ip,
    },
    db
  );
}
