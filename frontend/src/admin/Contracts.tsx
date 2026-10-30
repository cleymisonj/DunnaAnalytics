import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, FileCheck2, FilePlus2, FileText, Paperclip, Printer, RefreshCw, Save, Send, X } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { fileUrl, request, uploadDocuments } from './api'

type Item = { status: 'pending' | 'received' | 'na'; files: string[]; note: string }
type Contract = { id: string; revision: number; type: 'sale' | 'delivery' | 'purchase'; number: string; process: 'sale' | 'purchase'; dealId: string; purchaseId: string; vehicleId: string; personId: string; status: 'draft' | 'sent' | 'signed' | 'cancelled'; extraClauses: string; deliveredAt: string; deliveryMileage: number | null; deliveryItems: string; checklist: Record<string, Item>; signedFile: string; signedAt: string; createdAt: string; updatedAt: string }
type Checklists = Record<'sale' | 'purchase', [string, string, boolean][]>
type Doc = { title: string; sections: { heading: string; paragraphs: string[] }[]; frozen: boolean; missing: string[] }
type Legal = { legalName: string; document: string; address: string; cityUf: string; representative: string; representativeDocument: string; warrantyMonths: number; warrantyScope: string; forum: string }
type Deal = { id: string; vehicleId: string; personId: string; status: string; amountCents: number; vehicleLabel?: string }
type Purchase = { id: string; vehicleId: string; personId: string; personName: string; vehicleLabel: string; amountCents: number; status: string }
type Car = { id: string; brand: string; model: string; version: string; year: number }
type Person = { id: string; name: string }

const TYPE_LABEL: Record<Contract['type'], string> = { sale: 'Compra e venda', delivery: 'Termo de entrega', purchase: 'Compra (entrada)' }
const STATUS_LABEL: Record<Contract['status'], string> = { draft: 'Rascunho', sent: 'Enviado para assinatura', signed: 'Assinado', cancelled: 'Cancelado' }
const ITEM_LABEL: Record<Item['status'], string> = { pending: 'Pendente', received: 'Recebido', na: 'Não se aplica' }
const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fileLabel = (name: string, i: number) => `Arquivo ${i + 1} (${name.split('.').pop()?.toUpperCase()})`
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Abre o documento numa janela própria, já formatado para A4, e chama a impressão (ou "Salvar como PDF"). */
function printDocument(doc: Doc, number: string) {
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return false
  const body = doc.sections.map((s) => `${s.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : ''}${s.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}`).join('')
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)} · ${number}</title><style>@page{size:A4;margin:22mm 20mm}body{font:11.5pt/1.55 Georgia,'Times New Roman',serif;color:#111;max-width:170mm;margin:0 auto}h1{font-size:14pt;text-align:center;text-transform:uppercase;letter-spacing:.04em;margin:0 0 4mm}.num{text-align:center;font:9pt Arial,sans-serif;color:#555;margin-bottom:8mm}h2{font-size:11.5pt;margin:6mm 0 2mm}p{margin:0 0 3mm;text-align:justify;white-space:pre-line}</style></head><body><h1>${escapeHtml(doc.title)}</h1><div class="num">Contrato nº ${escapeHtml(number)}</div>${body}<script>window.onload=()=>{window.print()}<\/script></body></html>`)
  w.document.close()
  return true
}

export default function Contracts({ storeId, view }: { storeId: string; view: string }) {
  if (view === 'settings') return <LegalSettings storeId={storeId} />
  return <ContractList storeId={storeId} pendingOnly={view === 'pending'} />
}

function ContractList({ storeId, pendingOnly }: { storeId: string; pendingOnly: boolean }) {
  const [data, setData] = useState<{ contracts: Contract[]; checklists: Checklists } | null>(null)
  const [deals, setDeals] = useState<Deal[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [cars, setCars] = useState<Car[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<Contract | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([
      request<{ contracts: Contract[]; checklists: Checklists }>('/api/admin/contracts', {}, storeId),
      request<Deal[]>('/api/admin/deals', {}, storeId),
      request<Purchase[]>('/api/admin/purchases', {}, storeId),
      request<Car[]>('/api/admin/stock', {}, storeId),
      request<Person[]>('/api/admin/people', {}, storeId),
    ])
      .then(([c, d, p, v, pe]) => { if (!active) return; setData(c); setDeals(d); setPurchases(p); setCars(v); setPeople(pe); setError('') })
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Não foi possível carregar os contratos.'))
    return () => { active = false }
  }, [storeId, reload])

  const carLabel = (id: string) => { const c = cars.find((x) => x.id === id); return c ? `${c.brand} ${c.model} ${c.year}` : 'Veículo' }
  const personName = (id: string) => people.find((p) => p.id === id)?.name || '—'
  const pendingOf = (c: Contract) => (data?.checklists[c.process] || []).filter(([key, , required]) => required && c.checklist[key]?.status === 'pending').map(([, label]) => label)
  const rows = (data?.contracts || []).filter((c) => c.status !== 'cancelled' || !pendingOnly).filter((c) => !pendingOnly || pendingOf(c).length)

  const replace = (c: Contract) => { setData((d) => d && { ...d, contracts: d.contracts.map((x) => (x.id === c.id ? c : x)) }); setOpen(c) }

  return (
    <>
      {error && <div className="admin-notice" role="alert">{error} <button className="admin-text-button" onClick={() => setReload((n) => n + 1)}>Tentar novamente</button></div>}
      <div className="admin-section-actions">
        <span>{pendingOnly ? 'Processos com documentos obrigatórios pendentes' : 'Contratos gerados a partir das negociações e compras'}</span>
        <div className="perf-period">
          <button className="admin-secondary" onClick={() => setReload((n) => n + 1)} aria-label="Atualizar"><RefreshCw size={16} /></button>
          {!pendingOnly && <button className="admin-primary" onClick={() => setCreating(true)}><FilePlus2 size={16} /> Novo contrato</button>}
        </div>
      </div>
      <section className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Nº</th><th>Tipo</th><th>Cliente / vendedor</th><th>Veículo</th><th>Situação</th><th>{pendingOnly ? 'Pendências' : 'Documentos'}</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const list = data!.checklists[c.process]
                const done = list.filter(([key]) => c.checklist[key]?.status !== 'pending').length
                const pending = pendingOf(c)
                return (
                  <tr key={c.id} className="contract-row" onClick={() => setOpen(c)}>
                    <td><button type="button" className="admin-text-button" onClick={(e) => { e.stopPropagation(); setOpen(c) }}>{c.number}</button></td>
                    <td>{TYPE_LABEL[c.type]}</td>
                    <td>{personName(c.personId)}</td>
                    <td>{carLabel(c.vehicleId)}</td>
                    <td><em className={`contract-status ${c.status}`}>{STATUS_LABEL[c.status]}</em></td>
                    <td>{pendingOnly ? <small>{pending.join(' · ')}</small> : <span className={pending.length ? 'perf-negative' : 'perf-positive'}>{done}/{list.length}</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {data && !rows.length && <div className="admin-empty"><FileText size={32} /><h3>{pendingOnly ? 'Nenhuma pendência de documento' : 'Nenhum contrato ainda'}</h3><p>{pendingOnly ? 'Todos os documentos obrigatórios foram recebidos.' : 'Crie o contrato a partir de uma proposta de venda ou de uma compra registrada.'}</p></div>}
        </div>
      </section>
      <p className="perf-hint"><AlertTriangle size={14} /> Os textos são modelos de referência. Revise-os com o advogado da loja antes de usar.</p>
      {creating && <NewContract storeId={storeId} deals={deals} purchases={purchases} carLabel={carLabel} personName={personName} onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); setData((d) => d && { ...d, contracts: [c, ...d.contracts] }); setOpen(c) }} />}
      {open && data && <ContractDialog contract={open} checklist={data.checklists[open.process]} storeId={storeId} title={`${TYPE_LABEL[open.type]} nº ${open.number} · ${personName(open.personId)} · ${carLabel(open.vehicleId)}`} onClose={() => setOpen(null)} onSaved={replace} />}
    </>
  )
}

function NewContract({ storeId, deals, purchases, carLabel, personName, onClose, onCreated }: { storeId: string; deals: Deal[]; purchases: Purchase[]; carLabel: (id: string) => string; personName: (id: string) => string; onClose: () => void; onCreated: (c: Contract) => void }) {
  const [type, setType] = useState<Contract['type']>('sale')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options = type === 'purchase'
    ? purchases.filter((p) => p.status === 'confirmed').map((p) => ({ id: p.id, label: `${p.vehicleLabel} · ${p.personName} · ${money(p.amountCents)}` }))
    : deals.filter((d) => d.status !== 'cancelled').map((d) => ({ id: d.id, label: `${carLabel(d.vehicleId)} · ${personName(d.personId)} · ${money(d.amountCents)}${d.status === 'completed' ? ' · concluída' : ''}` }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onCreated(await request<Contract>('/api/admin/contracts', { method: 'POST', body: JSON.stringify({ type, [type === 'purchase' ? 'purchaseId' : 'dealId']: ref }) }, storeId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o contrato.')
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Novo contrato" description="O contrato usa os dados da negociação ou da compra, do cliente, do veículo e da loja." className="admin-root admin-dialog max-w-xl">
      <form className="admin-editor" onSubmit={submit}>
        <fieldset disabled={busy} className="admin-form-grid">
          <label className="admin-field wide"><span>Tipo</span>
            <select value={type} onChange={(e) => { setType(e.target.value as Contract['type']); setRef('') }}>
              <option value="sale">Contrato de compra e venda (venda ao cliente)</option>
              <option value="delivery">Termo de entrega e responsabilidade</option>
              <option value="purchase">Contrato de compra (entrada no estoque)</option>
            </select>
          </label>
          <label className="admin-field wide"><span>{type === 'purchase' ? 'Compra registrada' : 'Negociação'}</span>
            <select required value={ref} onChange={(e) => setRef(e.target.value)}>
              <option value="">{options.length ? 'Selecione' : type === 'purchase' ? 'Nenhuma compra registrada' : 'Nenhuma negociação aberta'}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          {error && <div className="admin-notice wide" role="alert">{error}</div>}
        </fieldset>
        <div className="admin-editor-footer"><button type="button" className="admin-secondary" onClick={onClose}>Fechar</button><button className="admin-primary" disabled={!ref || busy}><FilePlus2 size={16} /> Criar contrato</button></div>
      </form>
    </Dialog>
  )
}

function ContractDialog({ contract, checklist, storeId, title, onClose, onSaved }: { contract: Contract; checklist: [string, string, boolean][]; storeId: string; title: string; onClose: () => void; onSaved: (c: Contract) => void }) {
  const [tab, setTab] = useState<'document' | 'docs' | 'terms'>('document')
  const [doc, setDoc] = useState<Doc | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const closed = contract.status === 'signed' || contract.status === 'cancelled'

  useEffect(() => {
    let active = true
    request<Doc>(`/api/admin/contracts/${contract.id}/document`, {}, storeId).then((d) => active && setDoc(d)).catch((e) => active && setMessage(e.message))
    return () => { active = false }
  }, [contract.id, contract.revision, storeId])

  const act = async (path: string, body: object, done: string) => {
    setBusy(true)
    setMessage('')
    try {
      onSaved(await request<Contract>(`/api/admin/contracts/${contract.id}${path}`, { method: path ? 'POST' : 'PUT', body: JSON.stringify({ revision: contract.revision, ...body }) }, storeId))
      setMessage(done)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível concluir.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} description={`${STATUS_LABEL[contract.status]}${contract.signedAt ? ` em ${new Date(contract.signedAt).toLocaleDateString('pt-BR')}` : ''}`} className="admin-root admin-dialog max-w-4xl">
      <div className="contract-tabs" role="tablist">
        {([['document', 'Documento'], ['docs', 'Documentação'], ['terms', 'Ajustes']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {message && <div className="admin-notice contract-message" role="status">{message}</div>}
      {tab === 'document' && <DocumentTab contract={contract} doc={doc} busy={busy} storeId={storeId} onAct={act} />}
      {tab === 'docs' && <ChecklistTab contract={contract} checklist={checklist} storeId={storeId} busy={busy} onSave={(c) => act('', { checklist: c }, 'Documentação salva.')} />}
      {tab === 'terms' && <TermsTab contract={contract} closed={closed} busy={busy} onSave={(t) => act('', { ...t, checklist: contract.checklist }, 'Ajustes salvos.')} />}
    </Dialog>
  )
}

function DocumentTab({ contract, doc, busy, storeId, onAct }: { contract: Contract; doc: Doc | null; busy: boolean; storeId: string; onAct: (path: string, body: object, done: string) => void }) {
  const [signing, setSigning] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  if (!doc) return <p className="perf-muted contract-pad">Gerando documento…</p>
  const closed = contract.status === 'signed' || contract.status === 'cancelled'
  const sign = async () => {
    setError('')
    let signedFile = ''
    try {
      if (file) { setUploading(true); [signedFile] = await uploadDocuments([file], storeId) }
      onAct('/sign', { signedFile }, 'Contrato assinado. O texto foi congelado.')
      setSigning(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no envio.')
    } finally {
      setUploading(false)
    }
  }
  return (
    <div className="contract-pad">
      {!!doc.missing.length && (
        <div className="contract-missing" role="alert"><AlertTriangle size={16} /><div><strong>Falta completar para assinar:</strong> {doc.missing.join(', ')}.<small>Cliente em Pessoas, veículo no Estoque e loja em Jurídico › Dados da loja. Os espaços em branco aparecem como "____".</small></div></div>
      )}
      <div className="contract-actions">
        <button type="button" className="admin-secondary" onClick={() => printDocument(doc, contract.number) || alert('Permita pop-ups para imprimir o contrato.')}><Printer size={16} /> Imprimir / salvar PDF</button>
        {contract.status === 'draft' && <button type="button" className="admin-secondary" disabled={busy} onClick={() => onAct('', { status: 'sent', extraClauses: contract.extraClauses, deliveryItems: contract.deliveryItems, deliveryMileage: contract.deliveryMileage, deliveredAt: contract.deliveredAt }, 'Marcado como enviado para assinatura.')}><Send size={16} /> Marcar como enviado</button>}
        {!closed && <button type="button" className="admin-primary" disabled={busy || !!doc.missing.length} onClick={() => setSigning(true)}><FileCheck2 size={16} /> Marcar como assinado</button>}
        {contract.signedFile && <a className="admin-secondary" href={fileUrl(contract.signedFile)} target="_blank" rel="noreferrer"><Paperclip size={16} /> Via assinada</a>}
        {!closed && <button type="button" className="admin-text-button" disabled={busy} onClick={() => confirm('Cancelar este contrato?') && onAct('/cancel', {}, 'Contrato cancelado.')}>Cancelar contrato</button>}
      </div>
      {signing && (
        <div className="contract-sign">
          <p>Anexe a via assinada (PDF ou foto) para guardar junto do contrato. O texto atual será congelado.</p>
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {error && <p className="story-error">{error}</p>}
          <div className="contract-actions"><button type="button" className="admin-secondary" onClick={() => setSigning(false)}>Voltar</button><button type="button" className="admin-primary" disabled={uploading || busy} onClick={sign}>{uploading ? 'Enviando…' : file ? 'Enviar e confirmar assinatura' : 'Confirmar sem anexo'}</button></div>
        </div>
      )}
      <article className="contract-paper">
        <h3>{doc.title}</h3>
        <p className="contract-number">Contrato nº {contract.number}{doc.frozen ? ' · versão assinada' : ' · prévia'}</p>
        {doc.sections.map((s, i) => <section key={i}>{s.heading && <h4>{s.heading}</h4>}{s.paragraphs.map((p, j) => <p key={j}>{p}</p>)}</section>)}
      </article>
    </div>
  )
}

function ChecklistTab({ contract, checklist, storeId, busy, onSave }: { contract: Contract; checklist: [string, string, boolean][]; storeId: string; busy: boolean; onSave: (c: Record<string, Item>) => void }) {
  const [items, setItems] = useState(contract.checklist)
  const [uploading, setUploading] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const target = useRef('')
  useEffect(() => setItems(contract.checklist), [contract.checklist])
  const set = (key: string, patch: Partial<Item>) => setItems((all) => ({ ...all, [key]: { ...all[key], ...patch } }))
  const attach = async (list: FileList | null) => {
    const key = target.current
    if (!list?.length || !key) return
    setError('')
    setUploading(key)
    try {
      const names = await uploadDocuments([...list], storeId)
      set(key, { files: [...items[key].files, ...names], status: 'received' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no envio.')
    } finally {
      setUploading('')
      if (input.current) input.current.value = ''
    }
  }
  const changed = JSON.stringify(items) !== JSON.stringify(contract.checklist)
  return (
    <div className="contract-pad">
      <ul className="contract-checklist">
        {checklist.map(([key, label, required]) => {
          const item = items[key] || { status: 'pending', files: [], note: '' }
          return (
            <li key={key} className={item.status}>
              <div className="contract-check-head">
                <strong>{label}{required && <span aria-label="obrigatório"> *</span>}</strong>
                <select aria-label={`Situação: ${label}`} value={item.status} onChange={(e) => set(key, { status: e.target.value as Item['status'] })}>{Object.entries(ITEM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
              <div className="contract-check-files">
                {item.files.map((f, i) => (
                  <span key={f} className="contract-file"><a href={fileUrl(f)} target="_blank" rel="noreferrer"><Paperclip size={13} /> {fileLabel(f, i)}</a><button type="button" aria-label="Remover anexo" onClick={() => set(key, { files: item.files.filter((x) => x !== f) })}><X size={13} /></button></span>
                ))}
                <button type="button" className="admin-text-button" disabled={!!uploading} onClick={() => { target.current = key; input.current?.click() }}>{uploading === key ? 'Enviando…' : '+ Anexar'}</button>
                <input className="contract-note" placeholder="Observação" maxLength={300} value={item.note} onChange={(e) => set(key, { note: e.target.value })} />
              </div>
            </li>
          )
        })}
      </ul>
      <input ref={input} type="file" hidden multiple accept="application/pdf,image/*" onChange={(e) => void attach(e.target.files)} />
      {error && <p className="story-error">{error}</p>}
      <div className="contract-actions"><button type="button" className="admin-primary" disabled={busy || !changed} onClick={() => onSave(items)}><Save size={16} /> Salvar documentação</button></div>
    </div>
  )
}

function TermsTab({ contract, closed, busy, onSave }: { contract: Contract; closed: boolean; busy: boolean; onSave: (t: object) => void }) {
  const toLocal = (iso: string) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
  const [extra, setExtra] = useState(contract.extraClauses)
  const [deliveredAt, setDeliveredAt] = useState(toLocal(contract.deliveredAt))
  const [mileage, setMileage] = useState(contract.deliveryMileage === null ? '' : String(contract.deliveryMileage))
  const [items, setItems] = useState(contract.deliveryItems)
  if (closed) return <p className="perf-muted contract-pad">Contrato {contract.status === 'signed' ? 'assinado' : 'cancelado'}: as cláusulas não podem mais ser alteradas. A documentação continua editável.</p>
  return (
    <form className="contract-pad admin-form-grid" onSubmit={(e) => { e.preventDefault(); onSave({ status: contract.status, extraClauses: extra, deliveredAt: deliveredAt ? new Date(deliveredAt).toISOString() : '', deliveryMileage: mileage === '' ? null : Number(mileage), deliveryItems: items }) }}>
      {contract.type === 'delivery' && (
        <>
          <label className="admin-field"><span>Data e hora da entrega</span><input type="datetime-local" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} /></label>
          <label className="admin-field"><span>Quilometragem na entrega</span><input inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value.replace(/\D/g, ''))} /></label>
          <label className="admin-field wide"><span>Itens entregues</span><input maxLength={400} placeholder="chave principal, chave reserva, manual, estepe, macaco e triângulo" value={items} onChange={(e) => setItems(e.target.value)} /></label>
        </>
      )}
      <label className="admin-field wide"><span>Cláusulas adicionais</span><textarea rows={8} maxLength={6000} placeholder="Uma cláusula por parágrafo (separe com uma linha em branco)." value={extra} onChange={(e) => setExtra(e.target.value)} /></label>
      <div className="contract-actions wide"><button className="admin-primary" disabled={busy}><Save size={16} /> Salvar ajustes</button></div>
    </form>
  )
}

function LegalSettings({ storeId }: { storeId: string }) {
  const [legal, setLegal] = useState<Legal | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { request<Legal>('/api/admin/legal', {}, storeId).then(setLegal).catch((e) => setMessage(e.message)) }, [storeId])
  const docMask = useMemo(() => (v: string, cnpj: boolean) => { const d = v.replace(/\D/g, '').slice(0, cnpj ? 14 : 11); return cnpj ? d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2') : d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2') }, [])
  if (!legal) return message ? <div className="admin-notice">{message}</div> : null
  const set = (patch: Partial<Legal>) => setLegal({ ...legal, ...patch })
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      setLegal(await request<Legal>('/api/admin/legal', { method: 'PUT', body: JSON.stringify(legal) }, storeId))
      setMessage('Dados da loja salvos. Os contratos em rascunho já usam os novos dados.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível salvar.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="admin-card perf-section">
      <div className="admin-toolbar"><h2>Dados da loja para contratos</h2></div>
      <form className="admin-form-grid contract-pad" onSubmit={save}>
        <label className="admin-field wide"><span>Razão social</span><input maxLength={160} value={legal.legalName} onChange={(e) => set({ legalName: e.target.value })} /></label>
        <label className="admin-field"><span>CNPJ</span><input inputMode="numeric" value={docMask(legal.document, true)} onChange={(e) => set({ document: e.target.value.replace(/\D/g, '') })} /></label>
        <label className="admin-field"><span>Cidade / UF</span><input maxLength={80} placeholder="Natal/RN" value={legal.cityUf} onChange={(e) => set({ cityUf: e.target.value })} /></label>
        <label className="admin-field wide"><span>Endereço da sede</span><input maxLength={240} value={legal.address} onChange={(e) => set({ address: e.target.value })} /></label>
        <label className="admin-field"><span>Representante legal</span><input maxLength={120} value={legal.representative} onChange={(e) => set({ representative: e.target.value })} /></label>
        <label className="admin-field"><span>CPF do representante</span><input inputMode="numeric" value={docMask(legal.representativeDocument, false)} onChange={(e) => set({ representativeDocument: e.target.value.replace(/\D/g, '') })} /></label>
        <label className="admin-field"><span>Garantia contratual (meses)</span><input inputMode="numeric" value={String(legal.warrantyMonths)} onChange={(e) => set({ warrantyMonths: Number(e.target.value.replace(/\D/g, '') || 0) })} /></label>
        <label className="admin-field"><span>Cobertura da garantia</span><input maxLength={120} value={legal.warrantyScope} onChange={(e) => set({ warrantyScope: e.target.value })} /></label>
        <label className="admin-field wide"><span>Foro (contratos de compra)</span><input maxLength={80} placeholder="Natal/RN" value={legal.forum} onChange={(e) => set({ forum: e.target.value })} /></label>
        <p className="perf-muted perf-note wide">A garantia legal de 90 dias do Código de Defesa do Consumidor sempre consta nos contratos de venda; a garantia contratual é um adicional. Nas vendas ao consumidor, o foro é o do domicílio do comprador.</p>
        {message && <div className="admin-notice wide" role="status">{message}</div>}
        <div className="contract-actions wide"><button className="admin-primary" disabled={busy}><Save size={16} /> {busy ? 'Salvando…' : 'Salvar dados'}</button></div>
      </form>
    </section>
  )
}
