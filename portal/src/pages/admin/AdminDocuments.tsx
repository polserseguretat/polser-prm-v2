import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { listRecords, uploadRecord, updateRecord, deleteRecord, adminAudit, ApiError, type DocumentItem } from '../../lib/adminApi';
import { BASE_URL } from '../../lib/api';
import { AdminCard, Badge, Loading, ErrorBox, EmptyState, Modal } from '../../components/admin/ui';
import { fmtDate } from '../../lib/adminFormat';

export default function AdminDocuments() {
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listRecords<DocumentItem>('documents', { sort: '-updated', perPage: 200 })
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const togglePublished = async (d: DocumentItem) => {
    try {
      await updateRecord('documents', d.id, { published: !d.published });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut actualitzar.');
    }
  };

  const remove = async (d: DocumentItem) => {
    if (!confirm(`Esborrar "${d.title}"?`)) return;
    try {
      await deleteRecord('documents', d.id);
      adminAudit({ action: 'delete', entity: 'documents', entity_id: d.id }).catch(() => undefined);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut esborrar.');
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Materials</h1>
          <p className="admin-page-sub">Documents i recursos visibles al portal</p>
        </div>
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => setUploadOpen(true)}>
          Puja document
        </button>
      </div>

      <AdminCard>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState message="No hi ha documents." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Títol</th>
                  <th>Tipus</th>
                  <th>Categoria</th>
                  <th>Versió</th>
                  <th>Publicat</th>
                  <th>Actualitzat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.file ? (
                        <a className="admin-link" href={`${BASE_URL}/api/files/documents/${d.id}/${d.file}`} target="_blank" rel="noreferrer">
                          {d.title}
                        </a>
                      ) : (
                        d.title
                      )}
                    </td>
                    <td>{d.type || '—'}</td>
                    <td>{d.category || '—'}</td>
                    <td>{d.version || '—'}</td>
                    <td>
                      <Badge tone={d.published ? 'green' : 'gray'}>{d.published ? 'Sí' : 'No'}</Badge>
                    </td>
                    <td>{fmtDate(d.updated)}</td>
                    <td className="admin-row-actions">
                      <button type="button" className="admin-btn admin-btn-ghost" onClick={() => togglePublished(d)}>
                        {d.published ? 'Despublica' : 'Publica'}
                      </button>
                      <button type="button" className="admin-btn admin-btn-danger" onClick={() => remove(d)}>
                        Esborra
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <UploadDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} onCreated={() => { setUploadOpen(false); load(); }} />
    </div>
  );
}

function UploadDocumentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [version, setVersion] = useState('');
  const [published, setPublished] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Cal seleccionar un fitxer.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('title', title);
      if (type) fd.set('type', type);
      if (category) fd.set('category', category);
      if (version) fd.set('version', version);
      fd.set('published', String(published));
      fd.set('file', file);
      const created = await uploadRecord<DocumentItem>('documents', fd);
      adminAudit({ action: 'create', entity: 'documents', entity_id: created.id }).catch(() => undefined);
      setTitle('');
      setType('');
      setCategory('');
      setVersion('');
      setFile(null);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut pujar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Puja un document" onClose={onClose}>
      <form className="admin-form" onSubmit={submit}>
        <label className="admin-field">
          <span>Títol</span>
          <input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <div className="admin-form-grid">
          <label className="admin-field">
            <span>Tipus</span>
            <input className="admin-input" value={type} onChange={(e) => setType(e.target.value)} placeholder="contracte, manual…" />
          </label>
          <label className="admin-field">
            <span>Categoria</span>
            <input className="admin-input" value={category} onChange={(e) => setCategory(e.target.value)} />
          </label>
          <label className="admin-field">
            <span>Versió</span>
            <input className="admin-input" value={version} onChange={(e) => setVersion(e.target.value)} />
          </label>
          <label className="admin-field">
            <span>Fitxer</span>
            <input className="admin-input" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <label className="admin-checkbox">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Publicat
        </label>
        {error && <p className="error">{error}</p>}
        <div className="admin-actions">
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>
            Cancel·la
          </button>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
            {busy ? 'Pujant…' : 'Puja'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
