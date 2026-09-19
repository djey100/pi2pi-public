// ─── pi2pi Admin Bootstrap ───────────────────────────────────────────
// Creates the first Owner admin account in Supabase.
// Usage:
//   node --env-file=.env create_admin.js <email> <password> [display_name]
// Example:
//   node --env-file=.env create_admin.js dmitrii@pi2pi.io MyStrongPassword "Dmitriy"
//
// Or with .env.local:
//   node --env-file=.env.local create_admin.js dmitrii@pi2pi.io MyStrongPassword
//
// Subsequent admin accounts (Manager/Support) should be added through
// the admin UI by Owner. This script is only for bootstrapping.
//
// NOTE: requires Supabase to have admin_schema.sql executed first.

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env");
  process.exit(1);
}

const [email, password, displayName] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: node create_admin.js <email> <password> [display_name]");
  console.error("Example: node create_admin.js dmitrii@pi2pi.io MyStrongPass Dmitriy");
  process.exit(1);
}

if (password.length < 8) {
  console.error("❌ Password must be at least 8 characters");
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("❌ Invalid email format");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

(async () => {
  // Check if any Owner already exists — if so, refuse (bootstrap is one-shot)
  const { data: existing, error: checkErr } = await supabase
    .from("admin_users")
    .select("id, email, role")
    .eq("role", "owner")
    .limit(1);

  if (checkErr) {
    console.error("❌ Database error:", checkErr.message);
    console.error("   Did you run supabase/admin_schema.sql first?");
    process.exit(1);
  }

  if (existing && existing.length > 0) {
    console.error("❌ Owner already exists:", existing[0].email);
    console.error("   To create additional admins, log in to /admin as Owner and add them via UI.");
    console.error("   To replace Owner, manually delete from admin_users table first.");
    process.exit(1);
  }

  // Hash password (bcrypt cost 12 = good balance speed/security)
  const passwordHash = await bcrypt.hash(password, 12);

  // Insert
  const { data: newAdmin, error: insertErr } = await supabase
    .from("admin_users")
    .insert({
      email: email.toLowerCase(),
      password_hash: passwordHash,
      role: "owner",
      display_name: displayName || email.split("@")[0],
      active: true,
    })
    .select()
    .single();

  if (insertErr) {
    console.error("❌ Failed to create admin:", insertErr.message);
    process.exit(1);
  }

  // Audit log
  await supabase.from("admin_audit").insert({
    admin_id: newAdmin.id,
    admin_email: newAdmin.email,
    action: "bootstrap_owner",
    target: newAdmin.email,
    metadata: { method: "create_admin.js" },
  });

  console.log("✅ Owner created!");
  console.log("   Email:", newAdmin.email);
  console.log("   Role:", newAdmin.role);
  console.log("   ID:", newAdmin.id);
  console.log("");
  console.log("Now log in at: https://pi2pi-project.fly.dev/admin");
  console.log("(or your custom domain once configured)");
  process.exit(0);
})();
