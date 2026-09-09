/// <reference path="./types.d.ts" />
// =====================================================================
// P0/P4 — Configuració d'aplicació i SMTP des d'environament
// Aplica metadades i SMTP a l'arrencada (bootstrap) llegint variables
// d'entorn. Idempotent: només actualitza si la variable està definida.
// =====================================================================
onBootstrap((e) => {
  e.next()

  const settings = e.app.settings()

  // Metadades d'aplicació
  const appUrl = $os.getenv('PB_APP_URL')
  if (appUrl) settings.meta.appUrl = appUrl
  settings.meta.appName = 'PRM POLSER'

  // SMTP
  const smtpHost = $os.getenv('PB_SMTP_HOST')
  const smtpPort = $os.getenv('PB_SMTP_PORT')
  const smtpUser = $os.getenv('PB_SMTP_USER')
  const smtpPass = $os.getenv('PB_SMTP_PASS')
  const smtpFrom = $os.getenv('PB_SMTP_FROM')

  if (smtpHost) {
    settings.smtp.enabled = true
    settings.smtp.host = smtpHost
    if (smtpPort) settings.smtp.port = parseInt(smtpPort, 10)
    settings.smtp.username = smtpUser || ''
    settings.smtp.password = smtpPass || ''
  }
  if (smtpFrom) {
    // format "Nom <email>"
    const m = /^(.*?)\s*<([^>]+)>$/.exec(smtpFrom)
    settings.meta.senderName = m ? m[1].trim() : 'POLSER SEGURETAT'
    settings.meta.senderAddress = m ? m[2].trim() : smtpFrom.trim()
  }

  e.app.save(settings)
})
