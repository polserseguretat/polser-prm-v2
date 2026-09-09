import { useEffect, useState } from 'react';
import { getMaterials, assetUrl, type DocumentItem } from '../lib/api';

const FALLBACK: DocumentItem[] = [
  { id: 'd1', title: 'Contracte de col·laboració', type: 'contracte', category: 'Legal', file: null, version: 'v3.1', updated_at: '2026-08-01T10:00:00Z' },
  { id: 'd2', title: 'Dossier comercial 2026', type: 'material', category: 'Comercial', file: null, version: '2026-01', updated_at: '2026-01-15T10:00:00Z' },
  { id: 'd3', title: 'Manual d\'instal·lació (pisos)', type: 'manual', category: 'Tècnic', file: null, version: 'v1.2', updated_at: '2026-05-20T10:00:00Z' },
  { id: 'd4', title: 'Acord de confidencialitat', type: 'acord', category: 'Legal', file: null, version: 'v1.0', updated_at: '2025-11-10T10:00:00Z' },
];

const TYPE_LABEL: Record<string, string> = {
  contracte: 'Contracte',
  material: 'Material',
  manual: 'Manual',
  acord: 'Acord',
};

const TYPE_ORDER = ['contracte', 'material', 'manual', 'acord'];

export default function Materials() {
  const [materials, setMaterials] = useState<DocumentItem[]>(FALLBACK);
  const [type, setType] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getMaterials()
      .then((res) => {
        if (active) {
          setMaterials(res.data ?? FALLBACK);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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