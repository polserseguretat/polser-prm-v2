import type { ReactNode } from 'react';

export function AdminCard({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`admin-card ${className}`.trim()}>
      {(title || actions) && (
        <header className="admin-card-head">
          {title && <h2 className="admin-card-title">{title}</h2>}
          {actions && <div className="admin-card-actions">{actions}</div>}
        </header>
      )}
      <div className="admin-card-body">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, tone = '' }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className={`admin-kpi ${tone}`.trim()}>
      <span className="admin-kpi-value">{value}</span>
      <span className="admin-kpi-label">{label}</span>
      {hint && <span className="admin-kpi-hint">{hint}</span>}
    </div>
  );
}

export function Badge({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className={`admin-badge admin-badge-${tone || 'gray'}`}>{children}</span>;
}

export function Loading({ label = 'Carregant…' }: { label?: string }) {
  return <p className="admin-muted">{label}</p>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="admin-error">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="admin-btn admin-btn-ghost" onClick={onRetry}>
          Reintenta
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message = 'No hi ha dades.' }: { message?: string }) {
  return <p className="admin-empty">{message}</p>;
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="admin-pagination">
      <button type="button" className="admin-btn admin-btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Anterior
      </button>
      <span>
        Pàgina {page} de {totalPages}
      </span>
      <button
        type="button"
        className="admin-btn admin-btn-ghost"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Següent
      </button>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="admin-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={`admin-modal${wide ? ' admin-modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="admin-modal-head">
          <h2>{title}</h2>
          <button type="button" className="admin-modal-close" aria-label="Tanca" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="admin-modal-body">{children}</div>
        {footer && <footer className="admin-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: Array<{ id: string; label: string }>; active: string; onChange: (id: string) => void }) {
  return (
    <div className="admin-tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={active === t.id ? 'admin-tab active' : 'admin-tab'}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
