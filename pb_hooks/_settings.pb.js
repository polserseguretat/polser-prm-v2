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
//   - SMTP    -> PocketBase 0.40.3 NO llegeix PB_SMTP_* de l'entorn
//               (verificat: /api/settings mostra els defaults). Es fa per
//               API: PATCH /api/settings (install.sh, pas 6).
//   - appName / appUrl -> tampoc per entorn; PATCH /api/settings.
//
//  Queda aquí NOMÉS la part d'auxili en desenvolupament: revelar el codi
//  OTP als logs si OTP_DEV_REVEAL=true. MAI activar en producció.
//
//  NOTA (fix 2026-09-10): NO declarar const de mòdul per a OTP reveal — el
//  JSVM de PB usa un pool de VMs i una variable top-level pot no quedar al
//  closure dels hooks quan s'executen en una altra VM (ReferenceError).
//  S'avalua l'env per cada callback. El codi OTP real s'exposa als hooks de
//  mailer via e.meta.password / e.meta.otpId (NO a onRecordRequestOTPRequest).
// =====================================================================

// Seguretat extra per si el codi s'ha generat però el mailer no l'ha pogut enviar
onMailerRecordOTPSend((e) => {
  if ($os.getenv('OTP_DEV_REVEAL') !== 'true') return e.next()
  const email = e.record ? e.record.email() : ''
  const meta = e.meta || {}
  $app.logger().info('[otp:dev] Codi OTP', 'email', email, 'otpId', meta.otpId, 'password', meta.password)
  return e.next()
})