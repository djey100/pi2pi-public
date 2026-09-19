// Keeper heartbeat read/write logic — shared by server-arc.js (write) and
// admin_routes.js (read). Extracted so both are independently testable
// without importing server-arc.js's side-effecting module (env checks,
// process.exit, server.listen).

export function deriveKeeperStatus(hb, hbError, { rentalEscrow, propDepEscrow, now = Date.now(), staleAfterSeconds = 60 }) {
  if (hbError) {
    return { status: "database_error", message: "Could not read keeper_heartbeats: " + hbError.message };
  }
  if (!hb) return { status: "missing", message: "No heartbeat received yet" };

  const lastSeen = hb.updated_at || hb.created_at;
  const ageSeconds = Math.floor((now - new Date(lastSeen).getTime()) / 1000);
  const fields = {
    ageSeconds,
    lastHeartbeat: lastSeen,
    instanceId: hb.instance_id,
    keeperVersion: hb.keeper_version,
    chainId: hb.chain_id,
    escrowAddress: hb.escrow_address,
    propDepAddress: hb.propdep_address,
    nextAgreementId: hb.next_agreement_id,
    scannedCount: hb.scanned_count,
    actionsNeeded: hb.actions_needed,
    actionsExecuted: hb.actions_executed,
    lastAction: hb.last_action,
    lastTxHash: hb.last_tx_hash,
    lastError: hb.last_error,
    flyRegion: hb.fly_region,
  };

  if (ageSeconds >= staleAfterSeconds) {
    return { status: "stale", ...fields };
  }

  const warnings = [];
  if (hb.escrow_address && hb.escrow_address.toLowerCase() !== rentalEscrow)
    warnings.push("Keeper escrow address mismatch: " + hb.escrow_address);
  if (hb.propdep_address && hb.propdep_address.toLowerCase() !== propDepEscrow)
    warnings.push("Keeper propDep address mismatch: " + hb.propdep_address);

  return { status: warnings.length ? "mismatch" : "healthy", ...fields, warnings };
}

// Upserts one row per keeper instance (instance_id). Never throws — a
// Supabase outage must not take down the rest of the backend, and the
// failure reason (never a secret — Supabase's own error text) is logged
// server-side for diagnosis while the HTTP caller gets a generic message.
export async function writeKeeperHeartbeat(supabase, body) {
  try {
    const { error } = await supabase.from("keeper_heartbeats").upsert({
      instance_id: body.instanceId || "default",
      updated_at: new Date().toISOString(),
      keeper_version: body.keeperVersion || null,
      chain_id: body.chainId || null,
      rpc_url_host: body.rpcUrlHost || null,
      escrow_address: body.escrowAddress || null,
      propdep_address: body.propDepAddress || null,
      next_agreement_id: body.nextAgreementId ?? null,
      scanned_count: body.scannedCount ?? null,
      actions_needed: body.actionsNeeded ?? 0,
      actions_executed: body.actionsExecuted ?? 0,
      last_action: body.lastAction || null,
      last_tx_hash: body.lastTxHash || null,
      last_error: body.lastError || null,
      fly_region: body.flyRegion || null,
    }, { onConflict: "instance_id" });

    if (error) {
      console.error("[keeper-heartbeat] write failed:", error.message);
      return { status: 500, body: { error: "heartbeat write failed" } };
    }
    return { status: 200, body: { ok: true } };
  } catch (e) {
    console.error("[keeper-heartbeat] write threw:", e.message);
    return { status: 500, body: { error: "heartbeat write failed" } };
  }
}
