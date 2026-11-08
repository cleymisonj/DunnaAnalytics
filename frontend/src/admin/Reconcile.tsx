import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, FileUp } from 'lucide-react'
import { request } from './api'
import { Notice, dateBR, messageOf, moneyFull, readTextFile } from './kit'

type Category = { id: string; name: string; direction: 'income' | 'expense'; active: boolean }
type Account = { id: string; name: string; active: boolean }
type Row = { fitid: string; date: string; amountCents: number; direction: 'income' | 'expense'; memo: string; status: 'new' | 'suggested' | 'registered' | 'imported'; entryId?: string; entryLabel?: string; entryDue?: string }
type Choice = { action: 'match' | 'create' | 'ignore'; categoryId: string }

// Conciliação bancária: o extrato OFX é conferido com os lançamentos e nada é gravado antes da confirmação.
export function Reconcile({ storeId, categories, accounts, onDone }: { storeId: string; categories: Category[]; accounts: Account[]; onDone: (m: string) => void }) {
 const [accountId, setAccountId] = useState(accounts.find(a => a.active)?.id || ''), [rows, setRows] = useState<Row[]>([]), [choices, setChoices] = useState<Record<string, Choice>>({}), [file, setFile] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
 const load = async (f: File | undefined) => {
  if (!f) return
  setBusy(true); setError('')
  try {
   const r = await request<{ rows: Row[] }>('/api/admin/finance/ofx', { method: 'POST', body: JSON.stringify({ accountId, content: await readTextFile(f) }) }, storeId)
   setRows(r.rows); setFile(f.name)
   setChoices(Object.fromEntries(r.rows.filter(x => x.status === 'new' || x.status === 'suggested').map(x => [x.fitid, { action: x.status === 'suggested' ? 'match' : 'create', categoryId: '' }])))
  } catch (e) { setError(messageOf(e)); setRows([]); setFile('') } finally { setBusy(false) }
 }
 const pending = rows.filter(r => choices[r.fitid])
 const apply = async () => {
  setBusy(true); setError('')
  try {
   const items = [...pending.map(r => ({ ...r, ...choices[r.fitid] })), ...rows.filter(r => r.status === 'registered').map(r => ({ ...r, action: 'ignore' }))]
   const c = await request<{ matched: number; created: number; ignored: number }>('/api/admin/finance/reconcile', { method: 'POST', body: JSON.stringify({ accountId, items }) }, storeId)
   setRows([]); setChoices({}); setFile(''); onDone(`Conciliação concluída: ${c.matched} baixados, ${c.created} criados, ${c.ignored} sem lançamento novo.`)
  } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
 }
 const set = (fitid: string, patch: Partial<Choice>) => setChoices({ ...choices, [fitid]: { ...choices[fitid], ...patch } })
 return <section className="admin-card">
  <div className="admin-toolbar"><h2>Importar extrato</h2><select aria-label="Conta do extrato" value={accountId} disabled={rows.length > 0} onChange={e => setAccountId(e.target.value)}>{accounts.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
  <div className="dn-pad"><p className="dn-muted">Baixe o extrato em OFX no site do banco. O Dunna sugere o lançamento em aberto de mesmo valor com vencimento até 10 dias da data do banco. Transações já importadas não se repetem.</p>
   <label className="admin-upload dn-mt"><FileUp size={20} />{busy ? 'Lendo extrato…' : file || 'Selecionar arquivo OFX'}<input type="file" accept=".ofx,.OFX" disabled={busy || !accountId} onChange={e => { void load(e.target.files?.[0]); e.target.value = '' }} /></label>
   {error && <Notice>{error}</Notice>}</div>
  {rows.length > 0 && <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Data</th><th>Descrição no banco</th><th className="num">Valor</th><th>O que fazer</th></tr></thead><tbody>{rows.map(r => { const c = choices[r.fitid]; return <tr key={r.fitid}>
   <td>{dateBR(r.date)}</td>
   <td><strong className={r.direction === 'income' ? 'dn-in' : 'dn-out'}>{r.direction === 'income' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />} {r.memo}</strong></td>
   <td className="num">{moneyFull(r.direction === 'income' ? r.amountCents : -r.amountCents)}</td>
   <td>{r.status === 'imported' ? <span className="admin-status draft">Já importada</span> : r.status === 'registered' ? <span className="admin-status available">Já baixado: {r.entryLabel}</span> : <div className="dn-recon">
    <select aria-label="Ação" value={c.action} onChange={e => set(r.fitid, { action: e.target.value as Choice['action'] })}>{r.status === 'suggested' && <option value="match">Baixar: {r.entryLabel}{r.entryDue ? ` (venc. ${dateBR(r.entryDue)})` : ''}</option>}<option value="create">Criar lançamento pago</option><option value="ignore">Ignorar</option></select>
    {c.action === 'create' && <select aria-label="Categoria" value={c.categoryId} onChange={e => set(r.fitid, { categoryId: e.target.value })}><option value="">{r.direction === 'income' ? 'Outras receitas' : 'Outras despesas'}</option>{categories.filter(x => x.direction === r.direction && x.active && !x.id.startsWith('other-')).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
   </div>}</td></tr> })}</tbody></table></div>
   <footer className="admin-table-footer dn-recon-footer"><span>{rows.length} transações · {pending.length} para conciliar</span><button className="admin-primary" disabled={busy || (!pending.length && !rows.some(r => r.status === 'registered'))} onClick={apply}><CheckCircle2 size={16} /> Confirmar conciliação</button></footer></>}
 </section>
}
