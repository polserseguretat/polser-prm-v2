/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 002: metadades de presentació del servei
// Afegeix el camp JSON `presentation` a la col·lecció services, per al
// modal d'info del portal (Onboarding). Conté SÓLS metadades de
// presentació: { description, image }. El nom i els preus (preu inicial
// i quota mensual) es llegeixen dels camps propis `name`, `alta_fee` i
// `monthly_fee` (ÚNICA font de veritat) per no duplicar-los.
//
// API PB 0.40.3 (validada en runtime): NO hi ha fieldByName() ni
// SchemaField. Es construeix el camp amb la classe global de tipus
// (`JSONField`) i s'afegeix amb c.fields.add(field) + app.save(c).
// =====================================================================
migrate((app) => {
  const c = app.findCollectionByNameOrId('services')

  // Idempotent: comprova si el camp ja existeix recorrent els camps.
  let hasPresentation = false
  for (let i = 0; i < c.fields.length; i++) {
    if (c.fields[i].name === 'presentation') { hasPresentation = true; break }
  }
  if (!hasPresentation) {
    c.fields.add(new JSONField({ name: 'presentation', maxSize: 0 }))
    app.save(c)
  }

  // SEED: description + image per a cada servei (per codi).
  const presentationByCode = {
    pis: { description: 'Alarma antiintrusió per a pisos amb detectors de moviment, avís a policia i control des de l\'app.', image: '' },
    casa: { description: 'Alarma per a cases unifamiliars amb cobertura perimetral ampliada, avís a policia i gestió completa des de l\'app.', image: '' },
    oficina: { description: 'Protecció per a oficines i despatxos amb gestió d\'usuaris i control d\'accessos.', image: '' },
    botiga: { description: 'Solució per a botigues i locals comercials amb detectors, sirena exterior, botó de pànic i videovigilància integrada.', image: '' },
    amida: { description: 'Sistema a mida per a residències particulars, amb pressupost personalitzat segons les necessitats de cada llar.', image: '' },
    'amida-neg': { description: 'Sistema a mida per a negocis amb analítica de vídeo i cobertura adaptada al local.', image: '' },
  }

  const rows = app.findRecordsByFilter('services', '', 'code', 200, 0)
  for (const rec of rows) {
    const code = rec.get('code')
    const p = presentationByCode[code]
    if (p) {
      rec.set('presentation', JSON.parse(JSON.stringify(p)))
      try {
        app.save(rec)
      } catch (_) { /* si falla la guarda, seguim */ }
    }
  }
})