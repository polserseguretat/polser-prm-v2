/// <reference path="./types.d.ts" />
// =====================================================================
// Suport dev per a OTP + configuració d'aplicació
//
//  FIX (2026-09-09, Pol): s'ha ELIMINAT el bloc onBootstrap que feia
//  $app.save(settings) (PB_APP_URL / appName / SMTP). Causava un panic
//  de PocketBase 0.40.3 (SIGSEGV / nil pointer) en desar settings dins
//  d'onBootstrap, crashejant qualsevol arrencada amb aquest hook present
//  (independentment de l'esquema de col·leccions).
//
//  Aquestes configuracions NO calen al hook:
//   - SMTP    -> PocketBase el configura de forma NATIVA per variables
//               d'entorn PB_SMTP_HOST / PB_SMTP_PORT / PB_SMTP_USER /
//               PB_SMTP_PASS (i PB_EMAIL_FROM_NAME / PB_EMAIL_FROM_ADDRESS).
//   - appName / appUrl -> PB ho llegeix de PB_APP_URL i PB_APP_NAME.
//
//  Queda aquí NOMÉS la part d'auxili en desenvolupament: revelar el codi
//  OTP als logs si OTP_DEV_REVEAL=true. MAI activar en producció.
// =====================================================================

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