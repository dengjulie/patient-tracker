// Creates a provider account. There's no sign-up page (PRODUCT.md §7), so
// this script is how an admin adds someone.
//
//   npm run create-user -- jane@clinic.org "Dr. Jane Doe"
//
// It generates a random password and prints it once. Hand it to the provider
// securely. (Password change is on the Later list.)
import { randomBytes } from 'node:crypto';
import { pool, initDb, createUser } from './db.js';
import { hashPassword } from './auth.js';

const [email, name] = process.argv.slice(2);
if (!email || !name) {
  console.error('Usage: npm run create-user -- <email> "<full name>"');
  process.exit(1);
}

await initDb();
const password = randomBytes(12).toString('base64url');
try {
  const user = await createUser({ email, name, passwordHash: await hashPassword(password) });
  console.log(`Created ${user.name} <${user.email}>\nTemporary password: ${password}`);
} catch (err) {
  if (err.code !== '23505') throw err; // 23505 = unique violation
  console.error(`An account for ${email} already exists.`);
  process.exitCode = 1;
}
await pool.end();
