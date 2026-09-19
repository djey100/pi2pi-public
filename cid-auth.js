// CID authorization helper — shared between server and tests
// Verifies a specific CID belongs to a contract where addr is party

export async function isCidAuthorizedForAddr(supabase, cid, addr) {
  const addrLc = addr.toLowerCase();
  // 1. Check contract_forms (column: form, key separator: "-")
  try {
    const { data: cfRows, error: cfErr } = await supabase.from("contract_forms").select("key,form").limit(200);
    if (cfErr) { console.error("[cid-auth] contract_forms query error:", cfErr.message); return false; }
    for (const cf of (cfRows || [])) {
      const formStr = JSON.stringify(cf.form || {});
      if (!formStr.includes(cid)) continue;
      const parts = (cf.key || "").split("-").map(p => p.toLowerCase());
      if (parts.includes(addrLc)) return true;
    }
  } catch (e) { console.error("[cid-auth] contract_forms error:", e.message); return false; }
  // 2. Check active_contracts
  try {
    const { data: acRows, error: acErr } = await supabase.from("active_contracts").select("addr,data").limit(100);
    if (acErr) { console.error("[cid-auth] active_contracts query error:", acErr.message); return false; }
    for (const ac of (acRows || [])) {
      const dataStr = JSON.stringify(ac.data || {});
      if (!dataStr.includes(cid)) continue;
      const acAddr = (ac.addr || "").toLowerCase();
      const peerAddr = (ac.data?.peerAddr || "").toLowerCase();
      if (acAddr === addrLc || peerAddr === addrLc) return true;
    }
  } catch (e) { console.error("[cid-auth] active_contracts error:", e.message); return false; }
  return false;
}
