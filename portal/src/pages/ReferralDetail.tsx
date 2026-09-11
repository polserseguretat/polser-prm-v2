import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getReferral, getReferralEvents, type Referral, type ReferralEvent } from '../lib/api';

const STATUS_LABEL: Record<string, string> = {
  lead: 'Nou',
  contactado: 'Contactat',
  presupuesto: 'Pressupost',
  aceptado: 'Acceptat',
  instalado: 'Instal·lat',
  perdido: 'Perdut',
};

const STATUS_ORDER = ['lead', 'contactado', 'presupuesto', 'aceptado', 'instalado'];

const SOURCE_LABEL: Record<string, string> = {
  portal: 'Portal',
  onboarding: 'Onboarding',
  whatsapp: 'WhatsApp',
  email: 'Correu',
  telefono: 'Telèfon',
  web: 'Web',
};

export default function ReferralDetail() {
  const { id } = useParams<{ id: string }>();
  const [referral, setReferral] = useState<Referral | null>(null);
  const [events, setEvents] = useState<ReferralEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let active = true;
    Promise.allSettled([getReferral(id), getReferralEvents(id)]).then(([r, e]) => {
      if (!active) return;
      if (r.status === 'fulfilled') setReferral(r.value.data ?? null);
      if (e.status === 'fulfilled') setEvents(e.value.data ?? []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="page-inner">
        <p className="muted">Carregant…</p>
      </div>
    );
  }

  if (!referral) {
    return (
      <div className="page-inner">
        <h1 className="page-title">Referit no trobat</h1>
        <p className="muted">No s'ha pogut carregar aquest referit.</p>
        <Link className="btn btn-primary" to="/referrals">
          Torna als meus referits
        </Link>
      </div>
    );
  }

  const isLost = referral.status === 'perdido';
  const currentIndex = isLost ? STATUS_ORDER.length : STATUS_ORDER.indexOf(referral.status);

  const eventDateFor = (toStatus: string) => {
    const event = [...events].reverse().find((e) => e.to_status === toStatus);
    return event ? event.created_at : undefined;
  };

  const displayValue =
    referral.final_value ?? referral.estimated_value;

  return (
    <div className="page-inner">
      <Link className="back" to="/referrals">
        ← Els meus referits
      </Link>
      <h1 className="page-title">{referral.referral_code ?? 'Referit'}</h1>
      <p className="page-sub">
        Enviat el {formatDate(referral.stage_date || referral.created_at)}
        {referral.source ? ` · Origen: ${SOURCE_LABEL[referral.source] ?? referral.source}` : ''}
        {displayValue ? ` · Valor estimat ${fmtEuro(displayValue)}` : ''}
      </p>

      {/* Estat / timeline */}
      <section className="section">
        <h2 className="section-title">Estat</h2>
        <div className="timeline">
          {STATUS_ORDER.map((s) => {
            const reached = currentIndex > STATUS_ORDER.indexOf(s);
            const isCurrent = s === referral.status;
            return (
              <div
                key={s}
                className={'timeline-step' + (reached ? ' reached' : '') + (isCurrent ? ' current' : '')}
              >
                <span className="timeline-dot" />
                <div className="timeline-body">
                  <strong>{STATUS_LABEL[s]}</strong>
                  {reached && eventDateFor(s) && <span className="timeline-date">{formatDate(eventDateFor(s))}</span>}
                </div>
              </div>
            );
          })}
          {isLost && (
            <div className="timeline-step cancelled current">
              <span className="timeline-dot" />
              <div className="timeline-body">
                <strong>Perdut</strong>
                <em>No es genera comissió</em>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Client */}
      <section className="section">
        <h2 className="section-title">Client</h2>
        {referral.client_name || referral.client_phone || referral.client_email || referral.client_address ? (
          <dl className="detail-list">
            {referral.client_name && (
              <div className="detail-row">
                <dt>Nom</dt>
                <dd>{referral.client_name}</dd>
              </div>
            )}
            {referral.client_phone && (
              <div className="detail-row">
                <dt>Telèfon</dt>
                <dd>{referral.client_phone}</dd>
              </div>
            )}
            {referral.client_email && (
              <div className="detail-row">
                <dt>Correu</dt>
                <dd>{referral.client_email}</dd>
              </div>
            )}
            {referral.client_address && (
              <div className="detail-row">
                <dt>Adreça</dt>
                <dd>{referral.client_address}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="muted">Sense dades del client.</p>
        )}

        {referral.notes && (
          <div className="notes-block">
            <h4>Notes</h4>
            <p>{referral.notes}</p>
          </div>
        )}
      </section>

      {/* La teva comissió — quant cobraràs (sincronitzada des d'Odoo) */}
      <section className="section">
        <h2 className="section-title">La teva comissió</h2>
        <dl className="detail-list">
          <div className="detail-row">
            <dt>Per alta</dt>
            <dd>{referral.partner_commission_alta != null ? fmtEuro(referral.partner_commission_alta) : '—'}</dd>
          </div>
          <div className="detail-row">
            <dt>Recurrent (mensual)</dt>
            <dd>{referral.partner_commission_recurrente != null ? fmtEuro(referral.partner_commission_recurrente) : '—'}</dd>
          </div>
        </dl>
        {referral.partner_commission_recurrente === 0 && (
          <p className="muted">El perfil d'afiliat no genera comissió recurrent (0,00 €).</p>
        )}
        <p className="muted">Import que POLSER et pagarà per aquest referit, actualitzat des d'Odoo.</p>
      </section>

      {/* Sincronització amb Odoo */}
      <section className="section">
        <h2 className="section-title">Sincronització amb Odoo</h2>
        <dl className="detail-list">
          <div className="detail-row">
            <dt>Estat</dt>
            <dd>
              {referral.odoo_sync_status === 'ok' ? (
                <span className="sync-ok">Sincronitzat</span>
              ) : referral.odoo_sync_status === 'error' ? (
                <span className="sync-err">Error</span>
              ) : (
                <span className="sync-pending">{referral.odoo_sync_status}</span>
              )}
            </dd>
          </div>
          {referral.odo_opportunity_id ? (
            <div className="detail-row">
              <dt>ID oportunitat</dt>
              <dd>{referral.odo_opportunity_id}</dd>
            </div>
          ) : null}
          {referral.odo_customer_id ? (
            <div className="detail-row">
              <dt>ID client</dt>
              <dd>{referral.odo_customer_id}</dd>
            </div>
          ) : null}
          {referral.odo_sale_id ? (
            <div className="detail-row">
              <dt>ID venta</dt>
              <dd>{referral.odo_sale_id}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  );
}

function formatDate(iso?: string) {
  if (!iso) return 'Data desconeguda';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Data desconeguda';
  return d.toLocaleDateString('ca-ES', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtEuro(n: number) {
  return new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);
}