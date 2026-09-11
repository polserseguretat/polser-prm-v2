/// <reference path="../pb_hooks/types.d.ts" />
// =====================================================================
// PRM POLSER — Migració 002: metadades de presentació del servei
// Afegeix el camp JSON `presentation` a la col·lecció services, per al
// modal d'info del portal (Onboarding). Conté SÓLS metadades de
// presentació: { description, image }. El nom i els preus (preu inicial
// i quota mensual) es llegeixen dels camps propis `name`, `alta_fee` i
// `monthly_fee` (ÚNICA font de veritat) per no duplicar-los.
// =====================================================================

migrate((app) => {
  let services = app.findCollectionByNameOrId('services')

  // Afegeix el camp JSON `presentation` si no existeix (idempotent)
  if (!services.fieldsByName('presentation')) {
    const f = new SchemaField()
    f.name = 'presentation'
    f.type = 'json'
    services.fields.add(f)
    app.save(services)
  }

  // SEED: description + image per a cada servei (claus: description, image)
  const presentationByCode = {
    pis: { description: 'Alarma antiintrusió per a pisos. Detectors de moviment, avís a policia i control des de l\'app. Instal·lació ràpida i 24/7.', image: '' },
    casa: { description: 'Alarma per a cases unifamiliars amb més cobertura. Detectors perimetrals ampliats, avís a policia i gestió completa des de l\'app.', image: '' },
    oficina: { description: 'Protecció per a oficines i despatxos. Gestió d\'usuaris i control d\'accessos, amb central integrada per al dia a dia de l\'empresa.', image: '' },
    botiga: { description: 'Solució per a botigues i locals comercials. Detectors, sirena exterior, botó de pànic i videovigilància integrada.', image: '' },
    amida: { description: 'Sistema a mida per a residències particulars. Pressupost personalitzat segons les necessitats de cada llar.', image: '' },
    'amida-neg': { description: 'Sistema a mida per a negocis. Pressupost personalitzat amb analítica de vídeo i cobertura adaptada al local.', image: '' },
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