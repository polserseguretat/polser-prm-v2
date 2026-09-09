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
  const existing = $app.findFirstRecordByFilter(
    "wallet_ledger",
    'type = "recurring" && partner = {:partner} && referral = {:referral} && period = {:period}',
    { partner, referral: referral || "", period },
  );
  if (existing) {
    throw new BadRequestError(
      `Ja existeix la comissió recurrent del període ${period}.`,
    );
  }
  return e.next();
}, "wallet_ledger");

// ------------------------------------------------------------------
// 3. autonom_afiliat — perfil afiliat => MAI recurrent
// ------------------------------------------------------------------
function forceAfiliatNoRecurring(e) {
  const profile = e.record.get("profile");
  if (profile === "afiliat") {
    e.record.set("allow_recurring", false);
  }
  return e.next();
}
onRecordCreate(forceAfiliatNoRecurring, "commission_rules");
onRecordUpdate(forceAfiliatNoRecurring, "commission_rules");

// ------------------------------------------------------------------
// 4. referral_events — històric en tot canvi d'estat (append-only)
// ------------------------------------------------------------------
function writeReferralEvent(record, fromStatus) {
  const col = $app.findCollectionByNameOrId("referral_events");
  const ev = new Record(col);
  ev.set("referral", record.id);
  ev.set("from_status", fromStatus || null);
  ev.set("to_status", record.get("status"));
  ev.set("reason", record.get("notes") || null);
  $app.save(ev);
}

// alta inicial (status=lead) i transicions
onRecordAfterCreateSuccess((e) => {
  writeReferralEvent(e.record, null);
}, "referrals");

onRecordAfterUpdateSuccess((e) => {
  const newStatus = e.record.get("status");
  const oldStatus = e.record.original()?.get("status");
  if (newStatus && oldStatus && newStatus !== oldStatus) {
    writeReferralEvent(e.record, oldStatus);
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
