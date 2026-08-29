import { ChevronDown, ChevronUp, Clock3, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getProduct } from '../domain/data';
import type { HistoryRecord, HistoryStatus, HistoryUpdate } from '../domain/types';
import { useApp } from './AppContext';

const statuses: HistoryStatus[] = ['Prepared', 'Used', 'Rejected', 'Archived'];

export function HistoryPage() {
  const { history, loading, updateHistory } = useApp();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'All' | HistoryStatus>('All');
  const [expanded, setExpanded] = useState<number | null>(null);
  const filtered = useMemo(() => history.filter((item) => {
    const search = `${getProduct(item.product)?.shortName} ${item.postType} ${item.topic} ${item.visualStyle} ${describeStructure(item)} ${item.conceptTitle ?? ''} ${item.headline ?? ''}`.toLowerCase();
    return (status === 'All' || item.status === status) && search.includes(query.toLowerCase());
  }), [history, query, status]);
  const counts = Object.fromEntries(statuses.map((item) => [item, history.filter((record) => record.status === item).length]));
  const isEmpty = !loading && history.length === 0 && !query && status === 'All';

  return <div className="page-scroll history-page">
    <header className="page-header wide">
      <div><span className="eyebrow">Creative archive</span><h1>History</h1><p>Keep a clear record of prepared and used creative sessions.</p></div>
      <div className="history-total"><strong>{history.length}</strong><span>sessions</span></div>
    </header>

    <div className="history-toolbar">
      <label className="search-field"><Search size={16} /><span className="sr-only">Search history</span><input placeholder="Search product, concept, headline…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <label className="status-select"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option>All</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>

    <div className="history-summary">
      <span>Showing {filtered.length} of {history.length} sessions</span>
      <div className="history-filter-list" aria-label="Filter history by status">
        <button type="button" className={status === 'All' ? 'active' : ''} onClick={() => setStatus('All')}><span className="status-filter-dot status-filter-all" />All <strong>{history.length}</strong></button>
        {statuses.map((item) => <button type="button" key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(status === item ? 'All' : item)}><span className={`status-filter-dot status-filter-${item.toLowerCase()}`} />{item} <strong>{counts[item]}</strong></button>)}
      </div>
    </div>

    <section className="history-table" aria-label="Creative history sessions">
      <div className="history-table-head"><span>Date</span><span>Product</span><span>Structure</span><span>Topic</span><span>Concept / headline</span><span>Status</span><span /></div>
      {loading ? <div className="table-empty">Loading history…</div> : filtered.length === 0 ? <div className="table-empty"><Clock3 size={26} /><strong>{isEmpty ? 'No creative history yet' : 'No matching sessions'}</strong><span>{isEmpty ? 'Prepared and used creative sessions will appear here.' : 'Try a different search or status filter.'}</span></div> : filtered.map((item) => <HistoryRow key={item.id} item={item} open={expanded === item.id} onToggle={() => setExpanded(expanded === item.id ? null : item.id)} onSave={(update) => updateHistory(item.id, update)} />)}
    </section>
  </div>;
}

function HistoryRow({ item, open, onToggle, onSave }: { item: HistoryRecord; open: boolean; onToggle: () => void; onSave: (update: HistoryUpdate) => Promise<HistoryRecord> }) {
  const [conceptTitle, setConceptTitle] = useState(item.conceptTitle ?? '');
  const [headline, setHeadline] = useState(item.headline ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  return <div className={`history-row-wrap ${open ? 'open' : ''}`}>
    <button className="history-row" type="button" onClick={onToggle}>
      <span className="date-cell"><strong>{new Date(item.createdAt).toLocaleDateString('en', { day: '2-digit', month: 'short' })}</strong><small>{new Date(item.createdAt).getFullYear()}</small></span>
      <span className="direction-cell"><span className="product-monogram">{getProduct(item.product)?.shortName.slice(0, 1)}</span><span><strong>{getProduct(item.product)?.shortName}</strong><small>{item.workflowMode === 'DIRECT_IMAGE' ? 'Direct image prompt' : 'Explore 3 ideas'}</small></span></span>
      <span className="structure-cell"><strong>{item.postStructure === 'CAROUSEL' ? 'Carousel' : 'Single Image'}</strong><small>{item.postStructure === 'CAROUSEL' ? `${item.requestedSlideCount === 'AUTO' ? 'Auto' : item.requestedSlideCount ?? 'Auto'} slides` : 'One image'}</small></span>
      <span className="topic-cell"><strong>{item.topic}</strong><small>{item.visualStyle}</small></span>
      <span className="concept-cell"><strong>{item.conceptTitle || 'Not recorded yet'}</strong><small>{item.headline || item.postType}</small></span>
      <span><StatusBadge status={item.status} /></span><span className="row-chevron" aria-hidden="true">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
    </button>
    {open && <div className="history-editor">
      <div className="editor-grid"><label><span>Chosen concept title</span><input value={conceptTitle} onChange={(e) => setConceptTitle(e.target.value)} placeholder="e.g. The Morning Glow Reset" /></label><label><span>Headline</span><input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Final on-creative headline" /></label><label className="notes-field"><span>Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why it worked, edits to remember, or rejection reason…" /></label></div>
      <div className="editor-footer"><div className="quick-status"><span>Set status</span>{statuses.map((nextStatus) => <button type="button" key={nextStatus} className={item.status === nextStatus ? 'active' : ''} onClick={() => void onSave({ status: nextStatus })}>{nextStatus}</button>)}</div><button className="button primary small" type="button" onClick={() => void onSave({ conceptTitle: conceptTitle || null, headline: headline || null, notes: notes || null })}>Save details</button></div>
    </div>}
  </div>;
}

function StatusBadge({ status }: { status: HistoryStatus }) { return <span className={`status-badge status-${status.toLowerCase()}`}><span />{status}</span>; }
function describeStructure(item: HistoryRecord) { return item.postStructure === 'CAROUSEL' ? `Carousel · ${item.requestedSlideCount === 'AUTO' ? 'Auto' : item.requestedSlideCount ?? 'Auto'} slides` : 'Single Image'; }
