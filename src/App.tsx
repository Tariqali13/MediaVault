import { ChangeEvent, useMemo, useRef, useState } from 'react'
import {
  Bell, ChevronDown, Clock3, CloudUpload, FileImage, Folder,
  Grid2X2, LayoutList, MoreHorizontal, Plus, Search, ShieldCheck,
  SlidersHorizontal, Sparkles, Star, Upload, Users, X,
} from 'lucide-react'
import './App.css'
import './interactive.css'

type Asset = {
  id: number
  name: string
  type: string
  size: string
  owner: string
  updated: string
  labels: string[]
  color: string
  featured?: boolean
}

const initialAssets: Asset[] = [
  { id: 1, name: 'Autumn campaign hero', type: 'JPG', size: '8.4 MB', owner: 'Maya Chen', updated: 'Today, 10:42', labels: ['Campaign', 'Approved'], color: 'sunset', featured: true },
  { id: 2, name: 'Studio product set', type: 'PNG', size: '4.1 MB', owner: 'Samir Khan', updated: 'Today, 09:18', labels: ['Product'], color: 'blue' },
  { id: 3, name: 'Brand motion reel', type: 'MP4', size: '42.8 MB', owner: 'Olivia Reed', updated: 'Yesterday', labels: ['Video', 'Review'], color: 'violet' },
  { id: 4, name: 'Field notes collection', type: 'JPG', size: '11.2 MB', owner: 'Maya Chen', updated: 'Aug 08', labels: ['Editorial'], color: 'green' },
  { id: 5, name: 'Summer texture studies', type: 'PNG', size: '6.7 MB', owner: 'Alex Morgan', updated: 'Aug 05', labels: ['Inspiration'], color: 'pink' },
  { id: 6, name: 'Launch social toolkit', type: 'ZIP', size: '24.5 MB', owner: 'Olivia Reed', updated: 'Aug 03', labels: ['Campaign'], color: 'orange' },
]

function App() {
  const [query, setQuery] = useState('')
  const [assets, setAssets] = useState(initialAssets)
  const [activeNav, setActiveNav] = useState('Library')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [activeType, setActiveType] = useState('All')
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [collectionName, setCollectionName] = useState('')
  const [collections, setCollections] = useState(['Brand essentials', 'Campaigns', 'Product photography'])
  const fileInput = useRef<HTMLInputElement>(null)

  const filteredAssets = useMemo(
    () => assets.filter((asset) => asset.name.toLowerCase().includes(query.toLowerCase()) && (activeType === 'All' || asset.type === activeType)),
    [activeType, assets, query],
  )

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const startUpload = () => fileInput.current?.click()

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    const additions = files.map((file, index) => ({ id: Date.now() + index, name: file.name, type: (file.name.split('.').pop() ?? 'FILE').toUpperCase(), size: `${(file.size / 1024 / 1024).toFixed(1)} MB`, owner: 'Tariq Ali', updated: 'Just now', labels: ['Processing'], color: ['blue', 'violet', 'green'][index % 3] }))
    setAssets((current) => [...additions, ...current])
    await Promise.all(files.map((file) => fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'}/api/v1/assets`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'northstar-studio' }, body: JSON.stringify({ name: file.name, type: (file.name.split('.').pop() ?? 'JPG').toUpperCase(), size: `${(file.size / 1024 / 1024).toFixed(1)} MB` }) }).catch(() => undefined)))
    window.setTimeout(() => { setUploading(false); notify(`${files.length} asset${files.length > 1 ? 's' : ''} added to your library`) }, 500)
    event.target.value = ''
  }

  const createCollection = async () => {
    const name = collectionName.trim()
    if (!name) return
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'}/api/v1/collections`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'northstar-studio' }, body: JSON.stringify({ name }) })
      if (!response.ok) throw new Error('Collection creation failed')
    } catch { /* The interface remains usable without the local API. */ }
    setCollections((current) => [name, ...current])
    setCollectionName('')
    setCollectionOpen(false)
    setActiveNav('Collections')
    notify(`Collection “${name}” created`)
  }

  const selectedAsset = assets.find((asset) => asset.id === selected)
  const shareAsset = async () => {
    if (!selectedAsset) return
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'}/api/v1/assets/${selectedAsset.id}/share-links`, { method: 'POST', headers: { 'x-workspace-id': 'northstar-studio' } })
      const payload = await response.json()
      if (response.ok) { await navigator.clipboard?.writeText(payload.data.url); notify('Secure share link copied to clipboard'); return }
    } catch { /* Fall through to local confirmation for seed assets. */ }
    notify('Share link prepared for this demo asset')
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Sparkles size={16} /></span>MediaVault</div>
        <div className="workspace-switcher"><span className="workspace-avatar">N</span><span><b>Northstar Studio</b><small>Creative workspace</small></span><ChevronDown size={16} /></div>
        <nav>
          {activeNav === 'Collections' && <div className="collection-links">{collections.map((collection) => <button key={collection} onClick={() => notify(`Showing ${collection}`)}>{collection}</button>)}</div>}
          {[
            ['Library', Grid2X2], ['Collections', Folder], ['Shared with me', Users], ['Activity', Clock3],
          ].map(([label, Icon]) => <button key={String(label)} className={activeNav === label ? 'nav-item active' : 'nav-item'} onClick={() => setActiveNav(String(label))}><Icon size={18} />{String(label)}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item"><Star size={18} />Favorites</button>
          <button className="nav-item"><ShieldCheck size={18} />Access & security</button>
          <div className="storage"><div><span>Storage</span><b>68% of 100 GB</b></div><div className="progress"><i /></div><button>Manage plan</button></div>
          <div className="profile"><span className="profile-avatar">TA</span><span><b>Tariq Ali</b><small>Workspace owner</small></span><MoreHorizontal size={18} /></div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="mobile-brand">MediaVault</div>
          <label className="search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets, tags, people..." /><kbd>⌘ K</kbd></label>
          <button className="icon-button"><Bell size={19} /><i /></button>
          <button className="help">?</button>
        </header>

        <div className="page">
          <div className="breadcrumb"><span>Library</span><b>/</b><span>All assets</span></div>
          <div className="title-row"><div><h1>{activeNav === 'Library' ? 'Asset library' : activeNav}</h1><p>Organize, review and share your team’s creative work.</p></div><div className="actions"><button className="secondary" onClick={() => setCollectionOpen(true)}><Plus size={17} />New collection</button><button className="primary" onClick={startUpload}><Upload size={17} />Upload assets</button><input ref={fileInput} className="file-input" type="file" multiple onChange={uploadFiles} /></div></div>

          <section className="summary-grid">
            <article><span className="summary-icon blue"><FileImage size={20} /></span><div><small>Total assets</small><strong>1,284</strong><em>+12.6% this month</em></div></article>
            <article><span className="summary-icon purple"><Users size={20} /></span><div><small>Team members</small><strong>18</strong><em>4 active today</em></div></article>
            <article><span className="summary-icon orange"><CloudUpload size={20} /></span><div><small>Upload activity</small><strong>46</strong><em>Assets this week</em></div></article>
          </section>

          <section className="library-panel">
            <div className="panel-top"><div><h2>{activeNav === 'Library' ? 'All assets' : activeNav}</h2><span>{filteredAssets.length} items</span></div><div className="panel-controls"><div className="filter-wrap"><button className="filter" onClick={() => setFilterOpen((open) => !open)}><SlidersHorizontal size={16} />Filter</button>{filterOpen && <div className="filter-menu"><b>File type</b>{['All', 'JPG', 'PNG', 'MP4', 'ZIP'].map((type) => <button key={type} className={activeType === type ? 'chosen' : ''} onClick={() => { setActiveType(type); setFilterOpen(false) }}>{type}</button>)}</div>}</div><div className="view-toggle"><button className={view === 'grid' ? 'selected' : ''} onClick={() => setView('grid')}><Grid2X2 size={17} /></button><button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><LayoutList size={17} /></button></div></div></div>
            {view === 'grid' ? <div className="asset-grid">{filteredAssets.map((asset) => <button key={asset.id} className={selected === asset.id ? 'asset-card selected' : 'asset-card'} onClick={() => setSelected(asset.id)}><div className={`asset-preview ${asset.color}`}><span>{asset.type}</span>{asset.featured && <b>Featured</b>}<i className="asset-shape" /></div><div className="asset-info"><strong>{asset.name}</strong><span>{asset.owner} · {asset.updated}</span><div>{asset.labels.map((label) => <small key={label}>{label}</small>)}</div></div></button>)}</div> : <div className="asset-list">{filteredAssets.map((asset) => <button key={asset.id} onClick={() => setSelected(asset.id)}><span className={`mini-preview ${asset.color}`} /><strong>{asset.name}</strong><span>{asset.type}</span><span>{asset.size}</span><span>{asset.owner}</span><span>{asset.updated}</span><MoreHorizontal size={18} /></button>)}</div>}
            {filteredAssets.length === 0 && <div className="empty"><Search size={28} /><h3>No assets found</h3><p>Try a different keyword or clear your search.</p></div>}
          </section>
        </div>
      </section>
      {uploading && <div className="upload-modal"><CloudUpload size={32} /><strong>Preparing secure upload</strong><span>Checking file types and workspace permissions…</span><div className="modal-progress"><i /></div></div>}
      {collectionOpen && <div className="dialog-backdrop"><form className="dialog" onSubmit={(event) => { event.preventDefault(); void createCollection() }}><button type="button" className="close" onClick={() => setCollectionOpen(false)}><X size={18} /></button><Folder size={24} /><h2>Create collection</h2><p>Use collections to keep campaign assets organized.</p><input autoFocus value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder="e.g. Spring launch" /><button className="primary" type="submit">Create collection</button></form></div>}
      {selectedAsset && <aside className="asset-drawer"><button className="close" onClick={() => setSelected(null)}><X size={18} /></button><div className={`drawer-preview ${selectedAsset.color}`}><span>{selectedAsset.type}</span></div><h2>{selectedAsset.name}</h2><p>{selectedAsset.size} · Added {selectedAsset.updated}</p><h3>Details</h3><dl><dt>Owner</dt><dd>{selectedAsset.owner}</dd><dt>Status</dt><dd>Available</dd><dt>Tags</dt><dd>{selectedAsset.labels.join(', ')}</dd></dl><button className="secondary" onClick={() => void shareAsset()}>Copy share link</button></aside>}
      {toast && <div className="toast"><ShieldCheck size={18} />{toast}</div>}
    </main>
  )
}

export default App
