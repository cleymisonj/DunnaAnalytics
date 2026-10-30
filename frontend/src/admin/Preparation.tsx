import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CheckCircle2, Plus, RefreshCw, RotateCcw, Save, Trash2, Wrench } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { request } from './api'

type Task = { id: string; category: string; description: string; supplierId: string; costCents: number; status: 'todo' | 'doing' | 'done'; doneAt: string; ledgerId: string }
type Prep = { id: string; revision: number; vehicleId: string; vehicleLabel: string; status: 'in_progress' | 'ready'; startedAt: string; readyAt: string; tasks: Task[]; notes: string }
type Car = { id: string; brand: string; model: string; version: string; year: number; status: string; images: string[] }
type Person = { id: string; name: string; kind: string; active: boolean }

const TASK_LABEL: Record<Task['status'], string> = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluído' }
const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const daysSince = (from: string, to?: string) => Math.max(0, Math.floor(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 86400000))
const total = (p: Prep) => p.tasks.reduce((s, t) => s + (t.status === 'done' ? t.costCents : 0), 0)

export default function Preparation({ storeId }: { storeId: string }) {
  const [preps, setPreps] = useState<Prep[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [cars, setCars] = useState<Car[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [starting, setStarting] = useState(false)
  const [open, setOpen] = useState<Prep | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([request<{ preparations: Prep[]; categories: string[] }>('/api/admin/preparations', {}, storeId), request<Car[]>('/api/admin/stock', {}, storeId), request<Person[]>('/api/admin/people', {}, storeId)])
      .then(([p, c, pe]) => { if (!active) return; setPreps(p.preparations); setCategories(p.categories); setCars(c); setPeople(pe); setError('') })
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Não foi possível carregar a preparação.'))
    return () => { active = false }
  }, [storeId, reload])

  const running = preps.filter((p) => p.status === 'in_progress')
  const ready = preps.filter((p) => p.status === 'ready').slice(0, 12)
  const replace = (p: Prep) => { setPreps((all) => (all.some((x) => x.id === p.id) ? all.map((x) => (x.id === p.id ? p : x)) : [p, ...all])); setOpen(p) }

  return (
    <>
      {error && <div className="admin-notice" role="alert">{error} <button className="admin-text-button" onClick={() => setReload((n) => n + 1)}>Tentar novamente</button></div>}
      <div className="admin-section-actions">
        <span>Serviços concluídos com custo entram como despesa do veículo no financeiro e no custo da margem.</span>
        <div className="perf-period">
          <button className="admin-secondary" onClick={() => setReload((n) => n + 1)} aria-label="Atualizar"><RefreshCw size={16} /></button>
          <button className="admin-primary" onClick={() => setStarting(true)}><Plus size={16} /> Iniciar preparação</button>
        </div>
      </div>
      <div className="admin-stats">
        <div><span>Em preparação</span><strong>{running.length}</strong><small>veículo(s)</small></div>
        <div><span>Tempo médio</span><strong>{running.length ? Math.round(running.reduce((s, p) => s + daysSince(p.startedAt), 0) / running.length) : 0} dias</strong><small>dos que estão na oficina</small></div>
        <div><span>Custo em andamento</span><strong>{money(running.reduce((s, p) => s + total(p), 0))}</strong><small>serviços concluídos</small></div>
        <div><span>Prontos (últimos)</span><strong>{ready.length}</strong><small>{ready.length ? `média de ${Math.round(ready.reduce((s, p) => s + daysSince(p.startedAt, p.readyAt), 0) / ready.length)} dias` : '—'}</small></div>
      </div>
      {!running.length && !ready.length ? (
        <section className="admin-card"><div className="admin-empty"><Wrench size={32} /><h3>Nenhum veículo em preparação</h3><p>Ao comprar um carro, inicie a preparação para controlar oficina, estética e custos até ele ficar pronto para venda.</p></div></section>
      ) : (
        <>
          <ul className="prep-grid">{running.map((p) => <PrepCard key={p.id} prep={p} onOpen={() => setOpen(p)} />)}</ul>
          {!!ready.length && (
            <section className="admin-card perf-section">
              <div className="admin-toolbar"><h2>Prontos para venda</h2></div>
              <div className="admin-table-wrap"><table className="admin-table">
                <thead><tr><th>Veículo</th><th>Concluído em</th><th>Dias de preparação</th><th>Custo</th></tr></thead>
                <tbody>{ready.map((p) => <tr key={p.id} className="contract-row" onClick={() => setOpen(p)}><td><strong>{p.vehicleLabel}</strong></td><td>{new Date(p.readyAt).toLocaleDateString('pt-BR')}</td><td>{daysSince(p.startedAt, p.readyAt)}</td><td>{money(total(p))}</td></tr>)}</tbody>
              </table></div>
            </section>
          )}
        </>
      )}
      {starting && <StartDialog storeId={storeId} cars={cars.filter((c) => c.status !== 'sold' && !running.some((p) => p.vehicleId === c.id))} onClose={() => setStarting(false)} onStarted={(p) => { setStarting(false); replace(p) }} />}
      {open && <PrepDialog prep={open} car={cars.find((c) => c.id === open.vehicleId)} categories={categories} suppliers={people.filter((p) => p.active && p.kind !== 'customer')} storeId={storeId} onClose={() => setOpen(null)} onSaved={replace} onPublished={() => setReload((n) => n + 1)} />}
    </>
  )
}

function PrepCard({ prep, onOpen }: { prep: Prep; onOpen: () => void }) {
  const done = prep.tasks.filter((t) => t.status === 'done').length
  const days = daysSince(prep.startedAt)
  return (
    <li>
      <button type="button" className="prep-card" onClick={onOpen}>
        <strong>{prep.vehicleLabel}</strong>
        <small className={days > 10 ? 'perf-negative' : ''}>{days} dia(s) em preparação</small>
        <span className="prep-bar" aria-label={`${done} de ${prep.tasks.length} serviços concluídos`}><span style={{ width: `${prep.tasks.length ? (done / prep.tasks.length) * 100 : 0}%` }} /></span>
        <small>{done}/{prep.tasks.length} serviços · {money(total(prep))}</small>
        <small className="prep-next">{prep.tasks.find((t) => t.status === 'doing')?.description || prep.tasks.find((t) => t.status === 'todo')?.description || 'Tudo concluído'}</small>
      </button>
    </li>
  )
}

function StartDialog({ storeId, cars, onClose, onStarted }: { storeId: string; cars: Car[]; onClose: () => void; onStarted: (p: Prep) => void }) {
  const [vehicleId, setVehicleId] = useState('')
  const [template, setTemplate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onStarted(await request<Prep>('/api/admin/preparations', { method: 'POST', body: JSON.stringify({ vehicleId, template }) }, storeId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar.')
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Iniciar preparação" description="Escolha o veículo que vai para oficina, estética ou vistoria." className="admin-root admin-dialog max-w-xl">
      <form className="admin-editor" onSubmit={submit}>
        <fieldset disabled={busy} className="admin-form-grid">
          <label className="admin-field wide"><span>Veículo</span>
            <select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Selecione</option>
              {cars.map((c) => <option key={c.id} value={c.id}>{c.brand} {c.model} {c.version} {c.year}{c.status === 'draft' ? ' · rascunho' : ''}</option>)}
            </select>
          </label>
          <label className="prep-check wide"><input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} /> Começar com o checklist padrão (revisão, pneus, polimento, higienização, laudo e fotos)</label>
          {error && <div className="admin-notice wide" role="alert">{error}</div>}
        </fieldset>
        <div className="admin-editor-footer"><button type="button" className="admin-secondary" onClick={onClose}>Fechar</button><button className="admin-primary" disabled={!vehicleId || busy}><Wrench size={16} /> Iniciar</button></div>
      </form>
    </Dialog>
  )
}

function PrepDialog({ prep, car, categories, suppliers, storeId, onClose, onSaved, onPublished }: { prep: Prep; car?: Car; categories: string[]; suppliers: Person[]; storeId: string; onClose: () => void; onSaved: (p: Prep) => void; onPublished: () => void }) {
  const [tasks, setTasks] = useState(prep.tasks.map((t) => ({ ...t, cost: t.costCents ? String(t.costCents / 100).replace('.', ',') : '' })))
  const [notes, setNotes] = useState(prep.notes)
  const [publish, setPublish] = useState(car?.status === 'draft')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const readOnly = prep.status === 'ready'
  useEffect(() => { setTasks(prep.tasks.map((t) => ({ ...t, cost: t.costCents ? String(t.costCents / 100).replace('.', ',') : '' }))); setNotes(prep.notes) }, [prep])
  const cents = (v: string) => (v.trim() ? Math.round(Number(v.replace(/\./g, '').replace(',', '.')) * 100) : 0)
  const payload = useMemo(() => tasks.map(({ cost, ...t }) => ({ ...t, costCents: cents(cost) })), [tasks])
  const changed = JSON.stringify(payload) !== JSON.stringify(prep.tasks) || notes !== prep.notes
  const set = (i: number, patch: Partial<(typeof tasks)[number]>) => setTasks((all) => all.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  const call = async (path: string, body: object, done: string, revision = prep.revision): Promise<Prep | null> => {
    setBusy(true)
    setMessage('')
    try {
      const next = await request<Prep>(`/api/admin/preparations/${prep.id}${path}`, { method: path ? 'POST' : 'PUT', body: JSON.stringify({ revision, ...body }) }, storeId)
      onSaved(next)
      setMessage(done)
      return next
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível salvar.')
      return null
    } finally {
      setBusy(false)
    }
  }
  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (payload.some((t) => !Number.isFinite(t.costCents) || t.costCents < 0)) { setMessage('Confira os custos.'); return null }
    return call('', { tasks: payload, notes }, 'Serviços salvos. Os concluídos com custo já estão no financeiro.')
  }
  const finish = async () => {
    // Salva antes e conclui com a revisão que acabou de voltar
    let revision = prep.revision
    if (changed) { const saved = await save(); if (!saved) return; revision = saved.revision }
    const publishing = car?.status === 'draft' && publish
    if (await call('/finish', { publish: publishing }, publishing ? 'Preparação concluída e veículo publicado no estoque publicado.' : 'Preparação concluída.', revision) && publishing) onPublished()
  }
  const doneCost = payload.reduce((s, t) => s + (t.status === 'done' ? t.costCents : 0), 0)
  const plannedCost = payload.reduce((s, t) => s + (t.status !== 'done' ? t.costCents : 0), 0)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={prep.vehicleLabel} description={readOnly ? `Pronto em ${new Date(prep.readyAt).toLocaleDateString('pt-BR')} · ${daysSince(prep.startedAt, prep.readyAt)} dia(s) de preparação` : `Em preparação há ${daysSince(prep.startedAt)} dia(s)`} className="admin-root admin-dialog max-w-5xl">
      <form className="contract-pad" onSubmit={(e) => void save(e)}>
        <fieldset disabled={busy || readOnly} className="prep-fieldset">
          <div className="admin-table-wrap">
            <table className="admin-table prep-table">
              <thead><tr><th>Categoria</th><th>Serviço</th><th>Fornecedor</th><th>Custo (R$)</th><th>Situação</th><th aria-label="Remover" /></tr></thead>
              <tbody>
                {tasks.map((t, i) => (
                  <tr key={t.id || i} className={`prep-task ${t.status}`}>
                    <td><select aria-label="Categoria" value={t.category} onChange={(e) => set(i, { category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select></td>
                    <td><input aria-label="Serviço" maxLength={160} value={t.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                    <td><select aria-label="Fornecedor" value={t.supplierId} onChange={(e) => set(i, { supplierId: e.target.value })}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td><input aria-label="Custo" inputMode="decimal" placeholder="0,00" value={t.cost} onChange={(e) => set(i, { cost: e.target.value.replace(/[^\d.,]/g, '') })} /></td>
                    <td><select aria-label="Situação" value={t.status} onChange={(e) => set(i, { status: e.target.value as Task['status'] })}>{Object.entries(TASK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                    <td><button type="button" className="prep-remove" aria-label={`Remover ${t.description || 'serviço'}`} onClick={() => setTasks((all) => all.filter((_, j) => j !== i))}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!readOnly && <button type="button" className="admin-text-button" onClick={() => setTasks((all) => [...all, { id: '', category: categories[0] || 'Outros', description: '', supplierId: '', costCents: 0, status: 'todo', doneAt: '', ledgerId: '', cost: '' }])}><Plus size={14} /> Adicionar serviço</button>}
          <label className="admin-field prep-notes"><span>Observações</span><textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </fieldset>
        <p className="prep-summary">Concluído: <strong>{money(doneCost)}</strong>{plannedCost ? <> · Previsto a concluir: {money(plannedCost)}</> : null}</p>
        {message && <div className="admin-notice" role="status">{message}</div>}
        <div className="contract-actions">
          {readOnly ? (
            <button type="button" className="admin-secondary" disabled={busy} onClick={() => call('/reopen', {}, 'Preparação reaberta.')}><RotateCcw size={16} /> Reabrir preparação</button>
          ) : (
            <>
              <button className="admin-secondary" disabled={busy || !changed}><Save size={16} /> Salvar serviços</button>
              {car?.status === 'draft' && <label className="prep-check"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Publicar no estoque publicado ao concluir</label>}
              <button type="button" className="admin-primary" disabled={busy || !payload.length || payload.some((t) => t.status !== 'done')} onClick={finish} title={payload.some((t) => t.status !== 'done') ? 'Conclua ou remova os serviços pendentes' : undefined}><CheckCircle2 size={16} /> Concluir preparação</button>
            </>
          )}
        </div>
      </form>
    </Dialog>
  )
}
