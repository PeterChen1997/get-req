import { db } from "../lib/db";

const defaultCode = process.argv[2] || "HELLO2025";

try {
  db.createInviteCode(defaultCode);
  console.log(`Invite code created: ${defaultCode}`);
} catch {
  console.log(`Invite code "${defaultCode}" already exists`);
}

console.log("Current invite codes:");
for (const code of db.listInviteCodes()) {
  console.log(
    `  ${code.code} - ${code.used_count}/${code.max_uses} uses - ${code.active ? "active" : "revoked"}`
  );
}
