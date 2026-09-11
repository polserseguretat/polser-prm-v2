/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 004: UNIFICACIÓ MONETÀRIA A EUROS (2 decimals)
// ---------------------------------------------------------------
// FONT DEL PROBLEMA: la migració 001 va emmagatzemar els diners com a
// enters en CÈNTIMS (2799 = 27,99 €), però alguns camins (payouts via
// _portal.pb.js) guardaven EUROS, i el portal/Odoo treballen en EUROS.
// Resultat: barreja de sistemes -> xifres duplicades/truncades.
// AQUESTA MIGRACIÓ converteix a EUROS-DECIMALS (2 decimals) TOTS els
// camps monetaris, i deixa la mètrica canònica = EUROS.
//
// Després d'aquesta migració CAP camp monetari emmagatzema cèntims i
// CAP lloc del codi ha de fer *100 ni /100. Els hooks i el portal ja
// estan adaptats (fitxers _portal.pb.js, _crons.pb.js, portal/*).
// =====================================================================

migrate((app) => {
  const round2 = (x) => (x == null ? x : Math.round((Number(x) + Number.EPSILON) * 100) / 100);

  // ------------------------------------------------------------------
  // 1. Camps que viuen en CÈNTIMS i s'han de passar a EUROS (/100).
  // ------------------------------------------------------------------
  const centsToEuros = {
    services: ['alta_fee', 'monthly_fee'],
    referrals: ['estimated_value', 'final_value'],
    commission_rules: ['fixed_amount'],
    wallet_ledger: ['amount'],
    settings: ['min_payout', 'default_fixed_commission'],
  };

  for (const [name, fields] of Object.entries(centsToEuros)) {
    let col = null;
    try { col = app.findCollectionByNameOrId(name) } catch (_) { /* no existeix: omet */ }
    if (!col) continue;
    const BATCH = 500;
    let offset = 0;
    for (;;) {
      const rows = app.findRecordsByFilter(col.name, 'id != ""', '', BATCH, offset);
      if (!rows.length) break;
      for (const r of rows) {
        let changed = false;
        for (const f of fields) {
          const v = r.get(f);
          if (v == null) continue;
          const cents = Math.round((Number(v) + Number.EPSILON) * 100) / 100; // normalitza cèntims sencers
          const euros = round2(cents / 100);
          r.set(f, euros);
          changed = true;
        }
        if (changed) app.save(r);
      }
      offset += BATCH;
    }
  }

  // ------------------------------------------------------------------
  // 2. payouts.amount: CAS ESPECIAL. Històricament _portal.pb.js guardava
  //    `Math.round(amount)` amb amount EN EUROS -> per tant el valor ja
  //    és en EUROS (enter). NO dividir per 100; només normalitzem a 2
  //    decimals.
  // ------------------------------------------------------------------
  {
    let col = null;
    try { col = app.findCollectionByNameOrId('payouts') } catch (_) { /* no */ }
    if (col) {
      const BATCH = 500;
      let offset = 0;
      for (;;) {
        const rows = app.findRecordsByFilter(col.name, 'id != ""', '', BATCH, offset);
        if (!rows.length) break;
        for (const r of rows) {
          const v = r.get('amount');
          if (v == null) continue;
          const euros = round2(Number(v)); // ja euros: només 2 decimals
          if (euros !== Number(v)) { r.set('amount', euros); app.save(r); }
        }
        offset += BATCH;
      }
    }
  }
}, (app) => {
  // DOWN: revertir a cèntims (*100) — oposat dels canvis de dalt.
  const round2 = (x) => (x == null ? x : Math.round((Number(x) + Number.EPSILON) * 100) / 100);
  const eurosToCents = {
    services: ['alta_fee', 'monthly_fee'],
    referrals: ['estimated_value', 'final_value'],
    commission_rules: ['fixed_amount'],
    wallet_ledger: ['amount'],
    settings: ['min_payout', 'default_fixed_commission'],
  };
  for (const [name, fields] of Object.entries(eurosToCents)) {
    let col = null;
    try { col = app.findCollectionByNameOrId(name) } catch (_) { continue }
    if (!col) continue;
    const BATCH = 500; let offset = 0;
    for (;;) {
      const rows = app.findRecordsByFilter(col.name, 'id != ""', '', BATCH, offset);
      if (!rows.length) break;
      for (const r of rows) {
        let changed = false;
        for (const f of fields) {
          const v = r.get(f);
          if (v == null) continue;
          r.set(f, round2(Number(v) * 100));
          changed = true;
        }
        if (changed) app.save(r);
      }
      offset += BATCH;
    }
  }
  // payouts tornen a EUROS-enters com abans (no hi ha unitat cents real)
});