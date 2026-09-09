import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPortalMe, type PartnerOrg } from '../lib/api';
import { clearToken } from '../lib/session';

const FALLBACK_ORG: PartnerOrg = {
  id: 'p1',
  name: 'Polser Partners SL',
  profile: 'colaborador',
  type: 'administrador_fincas',
  nif: 'B12345678',
  email: 'partners@exemple.cat',
  phone: '+34 600 000 000',
  address: 'Carrer de Provença 300, 08037 Barcelona',
  status: 'actiu',
};

const PROFILE_LABEL: Record<string, string> = {
  afiliat: 'Afiliat',
  colaborador: 'Col·laborador',
};

const TYPE_LABEL: Record<string, string> = {
  inmobiliaria: 'Inmobiliària',
  administrador_fincas: 'Administrador de finques',
  operador_telecom: 'Operador de telecomunicacions',
  autonomo: 'Autònom',
  otro: 'Altres',
};

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendent',
  actiu: 'Actiu',
  inactiu: 'Inactiu',
  bloquejat: 'Bloquejat',
};

export default function Profile() {
  const navigate = useNavigate();
  const [org, setOrg] = useState<PartnerOrg>(FALLBACK_ORG);
  const [email, setEmail] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const logout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  useEffect(() => {
    let active = true;
    getPortalMe()
      .then((res) => {
        if (!active || !res.data) return;
        setOrg(res.data.partner ?? FALLBACK_ORG);
        setEmail(res.data.user.email);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const rows: Array<[string, string | undefined]> = [
    ['Perfil', PROFILE_LABEL[org.profile] ?? org.profile],
    ['Tipus', TYPE_LABEL[org.type] ?? org.type],
    ['NIF / DNI', org.nif ?? undefined],
    ['Correu electrònic', email ?? org.email ?? undefined],
    ['Telèfon', org.phone ?? undefined],
    ['Adreça', org.address ?? undefined],
    ['Estat', org.status ? STATUS_LABEL[org.status] ?? org.status : undefined],
  ];

  return (
    <div className="page-inner">
      <h1 className="page-title">El meu perfil</h1>
      <p className="page-sub">Dades de la vostra organització.</p>

      {loading ? (
        <p className="muted">Carregant…</p>
      ) : (
        <>
          <div className="profile-card">
            <div className="profile-head">
              <span className="brand-logo" aria-hidden="true">
                P
              </span>
              <div className="profile-head-text">
                <h2>{org.name}</h2>
                <span className="profile-role">{PROFILE_LABEL[org.profile] ?? org.profile}</span>
              </div>
            </div>

            <dl className="profile-rows">
              {rows.map(
                ([label, value]) =>
                  value && (
                    <div className="profile-row" key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ),
              )}
            </dl>
          </div>

          <button type="button" className="btn btn-ghost btn-block profile-logout" onClick={logout}>
            Tanca la sessió
          </button>
        </>
      )}
    </div>
  );
}