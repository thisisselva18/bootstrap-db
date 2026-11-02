// Usage: npm run hash-password -- "New Password 1"
// Prints a bcrypt hash to paste into AppUser.password_hash.
import bcrypt from "bcryptjs";

const plain = process.argv[2];
if (!plain) {
  console.error('Usage: npm run hash-password -- "<password>"');
  process.exit(1);
}
console.log(bcrypt.hashSync(plain, 10));
