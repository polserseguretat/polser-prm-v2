/// <reference path="./types.d.ts" />
// =====================================================================
// P0/P4 — Configuració d'aplicació i SMTP des d'environament
// Aplica metadades i SMTP a l'arrencada (bootstrap) llegint variables
// d'entorn. Idempotent: només actualitza si la variable està definida.
// =====================================================================
onBootstrap((e) => {
  e.next()

  const settings = e.app.settings()

  // Metadades d'aplicació (Object.assign per mutar propietats del host object)
  const appUrl = $os.getenv('PB_APP_URL')
  if (appUrl) Object.assign(settings.meta, { appUrl })
  Object.assign(settings.meta, { appName: 'PRM POLSER' })

  // SMTP
  const smtpHost = $os.getenv('PB_SMTP_HOST')
  const smtpPort = $os.getenv('PB_SMTP_PORT')
  const smtpUser = $os.getenv('PB_SMTP_USER')
  const smtpPass = $os.getenv('PB_SMTP_PASS')
  const smtpFrom = $os.getenv('PB_SMTP_FROM')

  if (smtpHost) {
    Object.assign(settings.smtp, {
      enabled: true,
      host: smtpHost,
      port: smtpPort ? parseInt(smtpPort, 10) : 465,
      username: smtpUser || '',
      password: smtpPass || '',
    })
  }
  if (smtpFrom) {
    const m = /^(.*?)\s*<([^>]+)>$/.exec(smtpFrom)
    Object.assign(settings.meta, {
      senderName: m ? m[1].trim() : 'POLSER SEGURETAT',
      senderAddress: m ? m[2].trim() : smtpFrom.trim(),
    })
  }

  e.app.save(settings)
})
