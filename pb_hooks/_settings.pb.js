/// <reference path="./types.d.ts" />
// =====================================================================
// Settings d'aplicació (bootstrap) + suport dev per a OTP
//  - Metadades: appName "PRM POLSER" + appUrl des de PB_APP_URL
//  - SMTP: si PB_SMTP_HOST està definit, configura settings.smtp
//    (el flux OTP de PocketBase envia el codi per email; sense SMTP
//    configurat l'enviament falla en silenci i el codi no arriba).
//  - Dev: si OTP_DEV_REVEAL=true, registra el codi OTP als logs
//    per poder provar el login sense SMTP. MAI activar en producció.
// =====================================================================

onBootstrap((e) => {
  const settings = e.app.settings()

  // Metadades d'aplicació
  const appUrl = $os.getenv('PB_APP_URL')
  if (appUrl) Object.assign(settings.meta, { appUrl })
  Object.assign(settings.meta, { appName: 'PRM POLSER' })

  // SMTP
  const smtpHost = $os.getenv('PB_SMTP_HOST')
  if (smtpHost) {
    Object.assign(settings.smtp, {
      enabled: true,
      host: smtpHost,
      port: parseInt($os.getenv('PB_SMTP_PORT') || '465', 10),
      username: $os.getenv('PB_SMTP_USER') || '',
      password: $os.getenv('PB_SMTP_PASS') || '',
    })
  }

  const smtpFrom = $os.getenv('PB_SMTP_FROM')
  if (smtpFrom) {
    // format "Nom <email>"
    const m = /^(.*?)\s*<([^>]+)>$/.exec(smtpFrom)
    Object.assign(settings.meta, {
      senderName: m ? m[1].trim() : 'POLSER SEGURETAT',
      senderAddress: m ? m[2].trim() : smtpFrom.trim(),
    })
  }

  e.app.save(settings)
})

// Dev: revela el codi OTP als logs (només si OTP_DEV_REVEAL=true)
const revealOtp = $os.getenv('OTP_DEV_REVEAL') === 'true'

onRecordRequestOTPRequest((e) => {
  if (!revealOtp) return e.next()
  if (e.collection.name !== 'partner_users') return e.next()
  if (!e.record) {
    $app.logger().warn('[otp:dev] No hi ha cap compte partner_users amb aquest email: no s\'enviarà cap codi.')
    return e.next()
  }
  $app.logger().info('[otp:dev] Codi OTP', 'email', e.record.email(), 'password', e.password)
  return e.next()
})

// Seguretat extra per si el codi s'ha generat però el mailer no l'ha pogut enviar
onMailerRecordOTPSend((e) => {
  if (!revealOtp) return e.next()
  const email = e.record ? e.record.email() : ''
  $app.logger().info('[otp:dev] Codi OTP (email)', 'email', email, 'password', e.meta && e.meta.password)
  return e.next()
})
