import { useState, type FormEvent } from 'react'
import { CheckCircle2, Download, FileUp, ShieldCheck } from 'lucide-react'
import { request, type Store } from './api'
import { DunnaLogo } from './Brand'
import { Field, Notice, downloadCsv, messageOf, readTextFile } from './kit'

// Recuperação de senha, dados da loja e importação de planilhas.

export function ForgotPassword({ onBack }: { onBack: () => void }) {
 const [email, setEmail] = useState(''), [sent, setSent] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
 const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { await request('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }); setSent(true) } catch (err) { setError(messageOf(err)) } finally { setBusy(false) } }
 return <><span className="admin-kicker">RECUPERAR ACESSO</span><h1>Esqueceu sua senha?</h1>{sent ? <p>Se este e-mail tiver uma conta ativa, enviamos um link válido por 1 hora. Não chegou? Peça ao administrador da loja um link em Equipe e acessos.</p> : <><p>Informe seu e-mail para receber um link de redefinição.</p><form onSubmit={submit}><Field label="E-mail"><input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></Field>{error && <Notice>{error}</Notice>}<button className="admin-primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'}</button></form></>}<button type="button" className="admin-text-button admin-back" onClick={onBack}>← Voltar para o login</button></>
}

export function ResetPassword({ token }: { token: string }) {
 const [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [done, setDone] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
 const submit = async (e: FormEvent) => { e.preventDefault(); if (password !== confirm) { setError('As senhas não conferem.'); return } setBusy(true); setError(''); try { await request('/api/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) }); setDone(true) } catch (err) { setError(messageOf(err)) } finally { setBusy(false) } }
 return <main className="admin-root admin-auth"><span className="admin-brand"><DunnaLogo /></span><section className="admin-auth-card"><span className="admin-kicker">NOVA SENHA</span><h1>{done ? 'Senha alterada' : 'Crie sua nova senha'}</h1>{done ? <><p>Todas as sessões antigas foram encerradas. Entre com a nova senha.</p><a className="admin-primary dn-mt" href="/">Ir para o login</a></> : <form onSubmit={submit}><Field label="Nova senha"><input type="password" autoComplete="new-password" required minLength={12} maxLength={200} value={password} onChange={e => setPassword(e.target.value)} /></Field><Field label="Repita a nova senha"><input type="password" autoComplete="new-password" required minLength={12} maxLength={200} value={confirm} onChange={e => setConfirm(e.target.value)} /></Field><small>Use pelo menos 12 caracteres.</small>{error && <Notice>{error}</Notice>}<button className="admin-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button></form>}</section><span className="admin-auth-note"><ShieldCheck size={15} /> Link de uso único, válido por 1 hora</span></main>
}

export function StoreSettings({ store, onSaved }: { store: Store; onSaved: () => void }) {
 const [v, setV] = useState({ name: store.name, phone: store.phone, city: store.city }), [error, setError] = useState(''), [busy, setBusy] = useState(false)
 const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { await request(`/api/admin/stores/${store.id}`, { method: 'PUT', body: JSON.stringify(v) }, store.id); onSaved() } catch (err) { setError(messageOf(err)) } finally { setBusy(false) } }
 return <section className="admin-card dn-pad dn-narrow"><h2>Dados da loja</h2><form onSubmit={submit} className="admin-form-grid"><Field label="Nome da loja *" wide><input required maxLength={200} value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></Field><Field label="Telefone com DDD *"><input required inputMode="tel" pattern="[0-9]{10,11}" placeholder="84999999999" value={v.phone} onChange={e => setV({ ...v, phone: e.target.value.replace(/\D/g, '').slice(0, 11) })} /></Field><Field label="Cidade / UF *"><input required maxLength={200} placeholder="Natal/RN" value={v.city} onChange={e => setV({ ...v, city: e.target.value })} /></Field><Field label="Identificador" wide><input disabled value={store.slug} /></Field>{error && <div className="wide"><Notice>{error}</Notice></div>}<div className="wide dn-row"><button className="admin-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar dados da loja'}</button></div></form><p className="dn-muted dn-mt">Razão social, CNPJ e representante usados nos contratos ficam em Jurídico › Dados da loja.</p></section>
}

/** Lê CSV com ; ou , (o Excel em português usa ;), aspas e quebras de linha dentro de campos. */
export function parseCsv(text: string) {
 const clean = text.replace(/^﻿/, ''), first = clean.split(/\r?\n/, 1)[0], delimiter = (first.match(/;/g)?.length || 0) >= (first.match(/,/g)?.length || 0) ? ';' : ','
 const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false
 for (let i = 0; i < clean.length; i++) {
  const ch = clean[i]
  if (quoted) { if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false; else cell += ch }
  else if (ch === '"') quoted = true
  else if (ch === delimiter) { row.push(cell); cell = '' }
  else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' }
  else cell += ch
 }
 if (cell || row.length) { row.push(cell); rows.push(row) }
 return rows.filter(r => r.some(c => c.trim()))
}
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

type Kind = 'vehicles' | 'people' | 'ledger'
const KINDS: Record<Kind, { label: string; note: string; columns: [string, string, string[]][]; example: string[] }> = {
 vehicles: { label: 'Veículos', note: 'Entram como rascunho: adicione fotos para publicar. Placa ou chassi repetidos são ignorados.', columns: [['brand', 'Marca', []], ['model', 'Modelo', []], ['version', 'Versão', []], ['year', 'Ano modelo', ['ano']], ['yearMade', 'Ano fabricação', ['fabricacao']], ['price', 'Preço', ['valor', 'preco de venda']], ['mileage', 'Km', ['quilometragem']], ['color', 'Cor', []], ['transmission', 'Câmbio', []], ['body', 'Carroceria', []], ['fuel', 'Combustível', []], ['plate', 'Placa', []], ['renavam', 'Renavam', []], ['chassis', 'Chassi', []], ['fipe', 'FIPE', []], ['notes', 'Observações', []]], example: ['Fiat', 'Argo', 'Drive 1.0', '2022', '2021', '72900,00', '41000', 'Branco', 'Manual', 'Hatch', 'Flex', 'ABC1D23', '', '', '', ''] },
 people: { label: 'Clientes e fornecedores', note: 'CPF/CNPJ ou telefone repetidos são ignorados.', columns: [['name', 'Nome', ['nome completo', 'razao social']], ['kind', 'Tipo', ['categoria']], ['phone', 'Telefone', ['celular', 'whatsapp']], ['email', 'E-mail', ['email']], ['document', 'CPF/CNPJ', ['cpf', 'cnpj', 'documento']], ['city', 'Cidade', []], ['address', 'Endereço', []], ['zip', 'CEP', []], ['notes', 'Observações', []]], example: ['Maria Souza', 'Cliente', '84999999999', 'maria@exemplo.com', '', 'Natal/RN', '', '', ''] },
 ledger: { label: 'Contas a pagar e receber', note: 'Preencha "Pago em" nas contas já quitadas. Entradas iguais (descrição, valor e vencimento) são ignoradas.', columns: [['direction', 'Tipo', []], ['description', 'Descrição', []], ['amount', 'Valor', []], ['dueDate', 'Vencimento', []], ['paidDate', 'Pago em', ['pagamento', 'data pagamento']], ['category', 'Categoria', []], ['notes', 'Observações', []]], example: ['Pagar', 'Aluguel de dezembro', '6500,00', '10/12/2026', '', 'Aluguel e condomínio', ''] },
}
type Result = { total: number; valid: number; duplicates: number[]; errors: { line: number; message: string }[]; errorCount: number; created: number }

export function Importer({ storeId, onDone }: { storeId: string; onDone: () => void }) {
 const [kind, setKind] = useState<Kind>('vehicles'), [rows, setRows] = useState<Record<string, string>[]>([]), [unknown, setUnknown] = useState<string[]>([]), [file, setFile] = useState(''), [check, setCheck] = useState<Result | null>(null), [done, setDone] = useState<Result | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
 const info = KINDS[kind]
 const reset = (k: Kind) => { setKind(k); setRows([]); setFile(''); setCheck(null); setDone(null); setError(''); setUnknown([]) }
 const send = (dryRun: boolean, list = rows) => request<Result>(`/api/admin/import/${kind}`, { method: 'POST', body: JSON.stringify({ rows: list, dryRun }) }, storeId)
 const load = async (f: File | undefined) => {
  if (!f) return
  setError(''); setCheck(null); setDone(null); setBusy(true)
  try {
   const table = parseCsv(await readTextFile(f))
   if (table.length < 2) throw new Error('A planilha precisa de um cabeçalho e ao menos uma linha.')
   const keys = table[0].map(h => { const name = fold(h); return info.columns.find(([key, label, alias]) => fold(label) === name || fold(key) === name || alias.includes(name))?.[0] || '' })
   if (!keys.some(Boolean)) throw new Error('Nenhuma coluna reconhecida. Use o modelo como referência e salve como CSV.')
   const parsed = table.slice(1).map(cells => Object.fromEntries(keys.flatMap((key, i) => key ? [[key, cells[i] ?? '']] : [])))
   setUnknown(table[0].filter((_, i) => !keys[i])); setRows(parsed); setFile(f.name); setCheck(await send(true, parsed))
  } catch (e) { setError(messageOf(e)); setRows([]); setFile('') } finally { setBusy(false) }
 }
 const confirm = async () => { setBusy(true); setError(''); try { const r = await send(false); setDone(r); setRows([]); setCheck(null); setFile(''); onDone() } catch (e) { setError(messageOf(e)) } finally { setBusy(false) } }
 return <section className="admin-card">
  <div className="admin-toolbar"><div className="dn-chips" role="group" aria-label="O que importar">{(Object.keys(KINDS) as Kind[]).map(k => <button key={k} className={`admin-chip ${kind === k ? 'active' : ''}`} onClick={() => reset(k)}>{KINDS[k].label}</button>)}</div><button className="admin-secondary" onClick={() => downloadCsv(`modelo-${kind}.csv`, info.columns.map(c => c[1]), [info.example])}><Download size={15} /> Baixar modelo</button></div>
  <div className="dn-pad"><p className="dn-muted">{info.note} No Excel, use Salvar como › CSV. Até 2.000 linhas por arquivo.</p>
   <label className="admin-upload dn-mt"><FileUp size={20} />{busy ? 'Conferindo planilha…' : file || 'Selecionar arquivo CSV'}<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { void load(e.target.files?.[0]); e.target.value = '' }} /></label>
   {error && <Notice>{error}</Notice>}
   {unknown.length > 0 && <p className="dn-muted dn-mt">Colunas ignoradas: {unknown.join(', ')}.</p>}
   {check && <div className="dn-import-check"><div className="admin-stats"><div><span>Linhas</span><strong>{check.total}</strong></div><div><span>Prontas</span><strong className="dn-in">{check.valid}</strong></div><div><span>Duplicadas</span><strong>{check.duplicates.length}</strong><small>{check.duplicates.length ? `Linhas ${check.duplicates.slice(0, 8).join(', ')}` : 'Nenhuma'}</small></div><div><span>Com erro</span><strong className={check.errorCount ? 'dn-bad' : ''}>{check.errorCount}</strong></div></div>
    {check.errors.length > 0 && <ul className="dn-import-errors">{check.errors.slice(0, 30).map(e => <li key={e.line}>Linha {e.line}: {e.message}</li>)}</ul>}
    <div className="dn-row"><button className="admin-primary" disabled={busy || !check.valid} onClick={confirm}>Importar {check.valid} {check.valid === 1 ? 'linha' : 'linhas'}</button></div></div>}
   {done && <div className="commercial-success dn-mt" role="status"><CheckCircle2 size={16} /> {done.created} registros importados{done.errorCount ? `, ${done.errorCount} linhas com erro ficaram de fora` : ''}.</div>}
  </div>
 </section>
}
