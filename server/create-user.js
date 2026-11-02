// Creates a provider account in a practice. There's no sign-up page
// (PRODUCT.md §7), so this script is how an admin adds someone. The provider
// will see only that practice's patients. The practice is created if it
// doesn't exist yet, and the script says so, so a typo is easy to spot.
//
//   npm run create-user -- jane@clinic.org "Dr. Jane Doe" "Riverside Family Medicine"
//
// It generates a random password and prints it once. Hand it to the provider
// securely. (Password change is on the Later list.)
import { randomBytes } from 'node:crypto';
import { pool, initDb, createUser, findOrCreatePractice } from './db.js';
import { hashPassword } from './auth.js';

const [email, name, practiceName] = process.argv.slice(2);
if (!email || !name || !practiceName) {
  console.error('Usage: npm run create-user -- <email> "<full name>" "<practice name>"');
  process.exit(1);
}

await initDb();
const { practice, created } = await findOrCreatePractice(practiceName);
if (created) console.log(`Created practice "${practice.name}".`);
const password = randomBytes(12).toString('base64url');
try {
  const user = await createUser({ practiceId: practice.id, email, name, passwordHash: await hashPassword(password) });
  console.log(`Created ${user.name} <${user.email}> in ${practice.name}\nTemporary password: ${password}`);
} catch (err) {
  if (err.code !== '23505') throw err; // 23505 = unique violation
  console.error(`An account for ${email} already exists.`);
  process.exitCode = 1;
}
await pool.end();
