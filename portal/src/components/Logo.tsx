/**
 * Marca de POLSER (símbol) per al portal i el panell d'administració.
 * El fitxer viu a `public/logo-white.svg`; funciona sobre fons clar i fosc,
 * així que no cal cap tile de fons.
 */
export default function Logo({ className = 'brand-logo' }: { className?: string }) {
  return <img src="/logo-white.svg" alt="polser.cat" className={className} />;
}
