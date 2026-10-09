import { useEffect, useState } from 'react';
import { getMaterials, assetUrl, type DocumentItem } from '../lib/api';

const TYPE_LABEL: Record<string, string> = {
  contracte: 'Contracte',
  material: 'Material',
  manual: 'Manual',
  acord: 'Acord',
};

const TYPE_ORDER = ['contracte', 'material', 'manual', 'acord'];

export default function Materials() {
  const [materials, setMaterials] = useState<DocumentItem[]>([]);
  const [type, setType] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    getMaterials()
      .then((res) => {
        if (active) setMaterials(res.data ?? []);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const filtered = type === 'all' ? materials : materials.filter((m) => m.type === type);

  return (
    <div className="page-inner">
      <h1 className="page-title">Materials</h1>
      <p className="page-sub">Biblioteca de documents i recursos per a la vostra activitat comercial.</p>

      <div className="chip-row">
        {['all', ...TYPE_ORDER].map((t) => (
          <button
            key={t}
            type="button"
            className={type === t ? 'chip active' : 'chip'}
            onClick={() => setType(t)}
          >
            {t === 'all' ? 'Tots' : TYPE_LABEL[t] ?? t}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="muted">Carregant…</p>
      ) : loadError ? (
        <div className="load-error">
          <p>No s'han pogut carregar els materials.</p>
          <button type="button" className="btn btn-ghost" onClick={() => setReloadKey((n) => n + 1)}>
            Torna-ho a provar
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="empty">No hi ha materials en aquesta categoria.</p>
      ) : (
        <div className="material-list">
          {filtered.map((m) => (
            <div className="material-card" key={m.id}>
              <div className="material-info">
                <div className="material-top">
                  <span className={`badge badge-${m.type ?? 'material'}`}>{TYPE_LABEL[m.type ?? ''] ?? m.type ?? 'Material'}</span>
                  {m.version && <span className="material-version">{m.version}</span>}
                </div>
                <strong>{m.title}</strong>
                <span className="material-date">
                  {m.category}
                  {m.updated_at ? ` · Actualitzat ${formatDate(m.updated_at)}` : ''}
                </span>
              </div>
              {m.file ? (
                <a className="btn btn-primary" href={assetUrl(m.file)} target="_blank" rel="noreferrer">
                  Descarregar
                </a>
              ) : (
                <span className="material-soon">Disponible aviat</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ca-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}