import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveKeeperStatus, writeKeeperHeartbeat } from "./keeper-heartbeat.js";

const RENTAL_ESCROW = "0x6cbf4d958da24b7adc98fb7633213ac26b5a6f3a";
const PROPDEP_ESCROW = "0x7428b32b61ee0678c6e3706cb7d5aa4ece818082";
const NOW = new Date("2026-08-15T10:00:00.000Z").getTime();

function freshRow(overrides = {}) {
  return {
    instance_id: "d897ee5b5346d8",
    updated_at: new Date(NOW - 10_000).toISOString(), // 10s old
    created_at: new Date(NOW - 10_000).toISOString(),
    escrow_address: RENTAL_ESCROW,
    propdep_address: PROPDEP_ESCROW,
    ...overrides,
  };
}

test("deriveKeeperStatus: healthy — fresh row, addresses match", () => {
  const result = deriveKeeperStatus(freshRow(), null, { rentalEscrow: RENTAL_ESCROW, propDepEscrow: PROPDEP_ESCROW, now: NOW });
  assert.equal(result.status, "healthy");
  assert.equal(result.warnings.length, 0);
  assert.equal(result.ageSeconds, 10);
});

test("deriveKeeperStatus: stale — row older than threshold", () => {
  const row = freshRow({ updated_at: new Date(NOW - 90_000).toISOString() }); // 90s old
  const result = deriveKeeperStatus(row, null, { rentalEscrow: RENTAL_ESCROW, propDepEscrow: PROPDEP_ESCROW, now: NOW });
  assert.equal(result.status, "stale");
  assert.equal(result.ageSeconds, 90);
});

test("deriveKeeperStatus: mismatch — fresh row, escrow address differs", () => {
  const row = freshRow({ escrow_address: "0x000000000000000000000000000000000000ab" });
  const result = deriveKeeperStatus(row, null, { rentalEscrow: RENTAL_ESCROW, propDepEscrow: PROPDEP_ESCROW, now: NOW });
  assert.equal(result.status, "mismatch");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /escrow address mismatch/i);
});

test("deriveKeeperStatus: mismatch — fresh row, propdep address differs", () => {
  const row = freshRow({ propdep_address: "0x000000000000000000000000000000000000cd" });
  const result = deriveKeeperStatus(row, null, { rentalEscrow: RENTAL_ESCROW, propDepEscrow: PROPDEP_ESCROW, now: NOW });
  assert.equal(result.status, "mismatch");
  assert.match(result.warnings[0], /propDep address mismatch/i);
});

test("deriveKeeperStatus: missing — no row, no error", () => {
  const result = deriveKeeperStatus(null, null, { rentalEscrow: RENTAL_ESCROW, propDepEscrow: PROPDEP_ESCROW, now: NOW });
  assert.equal(result.status, "missing");
});

test("deriveKeeperStatus: database_error — Supabase query returned an error", () => {
  const result = deriveKeeperStatus(null, { message: "relation \"public.keeper_heartbeats\" does not exist" }, {
    rentalEscrow: RENTAL_ESCROW, propDepEscrow: PROPDEP_ESCROW, now: NOW,
  });
  assert.equal(result.status, "database_error");
  assert.match(result.message, /keeper_heartbeats/);
});

test("writeKeeperHeartbeat: upserts successfully and returns 200", async () => {
  let capturedPayload = null;
  let capturedConflict = null;
  const mockSupabase = {
    from: () => ({
      upsert: (payload, opts) => {
        capturedPayload = payload;
        capturedConflict = opts?.onConflict;
        return Promise.resolve({ error: null });
      },
    }),
  };
  const result = await writeKeeperHeartbeat(mockSupabase, { instanceId: "abc123", chainId: 5042002 });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(capturedConflict, "instance_id");
  assert.equal(capturedPayload.instance_id, "abc123");
});

test("writeKeeperHeartbeat: defaults instance_id when not provided", async () => {
  let capturedPayload = null;
  const mockSupabase = {
    from: () => ({
      upsert: (payload) => { capturedPayload = payload; return Promise.resolve({ error: null }); },
    }),
  };
  await writeKeeperHeartbeat(mockSupabase, {});
  assert.equal(capturedPayload.instance_id, "default");
});

test("writeKeeperHeartbeat: Supabase returns an error — logs, does not throw, returns generic 500", async () => {
  const mockSupabase = {
    from: () => ({
      upsert: () => Promise.resolve({ error: { message: "relation \"public.keeper_heartbeats\" does not exist" } }),
    }),
  };
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const result = await writeKeeperHeartbeat(mockSupabase, { instanceId: "abc123" });
    assert.equal(result.status, 500);
    // Response body must not leak the raw Supabase error text.
    assert.equal(result.body.error, "heartbeat write failed");
    assert.ok(logged.some(l => l.includes("does not exist")), "failure reason should be logged server-side");
  } finally {
    console.error = originalError;
  }
});

test("writeKeeperHeartbeat: Supabase client throws — does not propagate, returns generic 500", async () => {
  const mockSupabase = {
    from: () => ({
      upsert: () => { throw new Error("network unreachable"); },
    }),
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await writeKeeperHeartbeat(mockSupabase, { instanceId: "abc123" });
    assert.equal(result.status, 500);
    assert.equal(result.body.error, "heartbeat write failed");
  } finally {
    console.error = originalError;
  }
});
