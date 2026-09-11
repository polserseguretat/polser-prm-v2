// <reference path="./types.d.ts" />
// =====================================================================
// P3 — Regles de negoci NO negociables (hooks)
//  1. ledger_immutable : cap UPDATE/DELETE extern sobre wallet_ledger
//     (sols via API request es bloqueja; el sistema/cron pot gestionar
//      estats programàticament). Correcció = entrada `reversal`.
//  2. recurring_unique : 1 recurrent per (partner+referral+period)
//  3. autonom_afiliat  : perfil afiliat => allow_recurring=false sempre
//  4. referral_events  : històric append-only en tot canvi d'estat
//  5. RGPD             : ocultar camps client_* de referrals a l'API
// =====================================================================

// ------------------------------------------------------------------
// 1. ledger_immutable — bloqueja UPDATE/DELETE via API (request hooks)
//    (els saves programàtics del sistema NO passen per *Request hooks)
// ------------------------------------------------------------------
onRecordUpdateRequest((e) => {
  throw new ForbiddenError(
    "El wallet_ledger és immutable. Usa una entrada reversal per corregir.",
  );
}, "wallet_ledger");

onRecordDeleteRequest((e) => {
  throw new ForbiddenError(
    "El wallet_ledger és immutable. No es permeten esborrats.",
  );
}, "wallet_ledger");

// ------------------------------------------------------------------
// 2. recurring_unique — defensa 100% al hook (obligatori)
//    S'aplica a qualsevol creació (API o cron) via onRecordCreate.
// ------------------------------------------------------------------
onRecordCreate((e) => {
  const r = e.record;
  if (r.get("type") !== "recurring") return e.next();

  const partner = r.get("partner");
  const referral = r.get("referral");
  const period = r.get("period");
  if (!partner || !period) return e.next(); // dades incompletes; es validaran després

  // cerca una recurrent existent del mateix partner+referral+period
  // NOTA (PB 0.40.3): findFirstRecordByFilter amb filtres de relació
  // (`partner = {:partner}` etc.) rebenta al JSVM; es fa la cerca sense
  // filtres de relació i es filtra per JS.
  try {
    const rows = $app.findRecordsByFilter("wallet_ledger", 'type = "recurring"', '', 1000, 0);
    const dup = rows.some((x) =>
      x.get("partner") === partner && x.get("referral") === referral && x.get("period") === period,
    );
    if (dup) {
      throw new BadRequestError(`Ja existeix la comissió recurrent del període ${period}.`);
    }
  } catch (err) {
    // Ja existeix -> bloqueja; qualsevol altre error es deixa passar (no bloquejar
    // la recurrent per un problema de filtre).
    if (err instanceof BadRequestError) throw err;
  }
  return e.next();
}, "wallet_ledger");

// ------------------------------------------------------------------
// 3. autonom_afiliat — regla CEO (08/09/2026), 3 capes
//    a) un partner type=autonomo és SEMPRE profile=afiliat (a la font)
//    b) perfil afiliat => MAI recurrent (allow_recurring=false)
//    c) UI del portal no ofereix la recurrent als autònoms
// ------------------------------------------------------------------
// Inline directe (JSVM 0.40.3): les funcions top-level no són visibles dins
// dels handlers (ReferenceError), per això es fa tot inline.
// a) un partner type=autonomo és SEMPRE profile=afiliat (a la font)
onRecordCreate((e) => {
  if (e.record.get("type") === "autonomo") {
    e.record.set("profile", "afiliat");
  }
  return e.next();
}, "partners");
onRecordUpdate((e) => {
  if (e.record.get("type") === "autonomo") {
    e.record.set("profile", "afiliat");
  }
  return e.next();
}, "partners");

// b) perfil afiliat => MAI recurrent (allow_recurring=false)
onRecordCreate((e) => {
  if (e.record.get("profile") === "afiliat") {
    e.record.set("allow_recurring", false);
  }
  return e.next();
}, "commission_rules");
onRecordUpdate((e) => {
  if (e.record.get("profile") === "afiliat") {
    e.record.set("allow_recurring", false);
  }
  return e.next();
}, "commission_rules");

// ------------------------------------------------------------------
// 4. referral_events — històric en tot canvi d'estat (append-only)
//    IMPORTANT (PB 0.40.3 JSVM): els handlers corren en un pool de VMs on
//    NO són visibles les funcions top-level del fitxer. Per això la gestió
//    d'events es fa INLINE dins de cada callback (evita el ReferenceError
//    "writeReferralEvent is not defined" que trencava la creació i cada
//    update de referrals).
// ------------------------------------------------------------------

// alta inicial (status=lead)
onRecordAfterCreateSuccess((e) => {
  const col = $app.findCollectionByNameOrId("referral_events");
  const ev = new Record(col);
  ev.set("referral", e.record.id);
  ev.set("to_status", e.record.get("status"));
  ev.set("reason", e.record.get("notes") || null);
  try { $app.save(ev); } catch (_) { /* append-only; si falla no bloqueja */ }
}, "referrals");

// transicions d'estat — UN SOL handler (events + comissió d'alta).
// IMPORTANT (PB 0.40.3): només s'executa el primer `onRecordAfterUpdateSuccess`
// registrat per col·lecció; per això events i alta van al mateix callback.
onRecordAfterUpdateSuccess((e) => {
  const newStatus = e.record.get("status");
  const oldStatus = e.record.original()?.get("status");
  const statusChanged = newStatus && oldStatus && newStatus !== oldStatus;

  // (a) històric append-only
  if (statusChanged) {
    const col = $app.findCollectionByNameOrId("referral_events");
    const ev = new Record(col);
    ev.set("referral", e.record.id);
    ev.set("from_status", oldStatus || null);
    ev.set("to_status", newStatus);
    ev.set("reason", e.record.get("notes") || null);
    try { $app.save(ev); } catch (_) { /* append-only */ }
  }

  // (b) comissió d'alta en instal·lar-se — vàlida per a TOTS els perfils
  //     (l'alta no té restricció CEO, només la recurrent). Idempotent.
  if (newStatus === "instalado" && oldStatus !== "instalado") {
    const partnerId = e.record.get("partner");
    if (partnerId) {
      // reflecteix que el servei està actiu (la recurrent mensual també el mira)
      if (!e.record.get("active_subscription")) {
        try { e.record.set("active_subscription", true); $app.save(e.record); } catch (_) { /* idempotent */ }
      }
      try {
        // idempotència sense filtre de relació ({:ref}) que pot no enllaçar bé:
        const highs = $app.findRecordsByFilter("wallet_ledger", 'type = "high"', '', 100, 0);
        if (!highs.some((x) => x.get("referral") === e.record.id)) {
          let amount = 0;
          try {
            const refCol = $app.findCollectionByNameOrId("referrals");
            if (refCol.fields.getByName("partner_commission_alta")) {
              amount = Number(e.record.get("partner_commission_alta") || 0);
            }
          } catch (_) { amount = 0; }
          if (!(amount > 0)) {
            try {
              const s = $app.findFirstRecordByFilter("settings", 'id != ""');
              amount = Number((s && s.get("default_fixed_commission")) || 60);
            } catch (_) { amount = 60; }
          }
          const amount2 = Math.round((Number(amount) + Number.EPSILON) * 100) / 100; // euros, 2 dec
          const col = $app.findCollectionByNameOrId("wallet_ledger");
          const entry = new Record(col);
          entry.set("partner", partnerId);
          entry.set("referral", e.record.id);
          entry.set("type", "high");
          entry.set("amount", amount2);
          entry.set("period", new Date().toISOString().slice(0, 7)); // YYYY-MM
          entry.set("status", "accrued");
          entry.set("description", "Comissió d'alta" + (e.record.get("referral_code") ? ` (${e.record.get("referral_code")})` : ""));
          try {
            $app.save(entry);
            $app.logger().info("[high_commission] acreditada", "partner", partnerId, "referral", e.record.id, "amount", amount2);
          } catch (err) {
            $app.logger().warn("[high_commission] no creada", "error", String(err.message || err));
          }
        } else {
          $app.logger().info("[high_commission] ja existent", "referral", e.record.id);
        }
      } catch (err) {
        $app.logger().error("[high_commission] error", "referral", e.record.id, "error", String((err && err.message) || err));
      }
    }
  }
}, "referrals");

// ------------------------------------------------------------------
// 5. RGPD — ocultar camps client_* de referrals (xarxa de seguretat
//    a més dels camps `hidden` definits a l'esquema)
// ------------------------------------------------------------------
onRecordEnrich((e) => {
  if (e.record.collection().name !== "referrals") return e.next();
  // els superusers (dashboard POLSER) sí que els veuen
  if (e.requestInfo.hasSuperuserAuth()) return e.next();
  // per a qualsevol altre (incl. partners), ocultem les dades personals
  e.record.hide("client_name");
  e.record.hide("client_phone");
  e.record.hide("client_email");
  e.record.hide("client_address");
  return e.next();
});
