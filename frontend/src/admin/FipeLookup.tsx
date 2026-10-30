import { useEffect, useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { brl } from '@/lib/utils'
import { request } from './api'

type Item = { code: string; name: string }
type Price = { price: number; code: string; reference: string; model: string; modelYear: number | null; fuel: string }
export type FipeResult = { fipe: number; fipeCode: string; fipeReference: string }

type Props = {
  storeId: string
  brand: string
  model: string
  version: string
  year: number
  fuel: string
  onApply: (r: FipeResult) => void
  onClose: () => void
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim()

/** Pontua o quanto um modelo FIPE combina com o carro (palavras do modelo e da versão). */
function score(name: string, words: string[], hints: string[]) {
  const n = ` ${norm(name)} `
  const has = (w: string) => n.includes(` ${w} `) || n.includes(` ${w}`)
  const base = words.reduce((s, w) => s + (has(w) ? (w.length > 2 ? 2 : 1) : 0), 0)
  // Combustível e câmbio do carro só desempatam (ex.: "Flex" e "Aut." entre versões do Corolla GLi)
  return base ? base + hints.filter(has).length : 0
}

/** O ano 32000 é como a FIPE identifica o zero km. */
const yearLabel = (name: string) => name.replace(/^32000/, 'Zero km')

export function FipeLookup({ storeId, brand, model, version, year, fuel, onApply, onClose }: Props) {
  const hints = useMemo(() => {
    const v = norm(version)
    return [norm(fuel).split(' ')[0], /automatic|aut|cvt/.test(v) ? 'aut' : /manual|mec/.test(v) ? 'mec' : ''].filter(Boolean)
  }, [version, fuel])
  const [brands, setBrands] = useState<Item[]>([])
  const [brandCode, setBrandCode] = useState('')
  const [models, setModels] = useState<Item[]>([])
  const [query, setQuery] = useState(`${model} ${version}`.replace(/\b(Automático|Manual|Automatizado)\b/gi, '').trim())
  const [modelCode, setModelCode] = useState('')
  const [years, setYears] = useState<Item[]>([])
  const [yearCode, setYearCode] = useState('')
  const [price, setPrice] = useState<Price | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const get = async <T,>(path: string, label: string): Promise<T | null> => {
    setBusy(label)
    setError('')
    try {
      return await request<T>(`/api/admin/fipe${path}`, {}, storeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Consulta FIPE indisponível.')
      return null
    } finally {
      setBusy('')
    }
  }

  // 1) Marcas; escolhe a do carro
  useEffect(() => {
    void get<Item[]>('/brands', 'marcas').then((list) => {
      if (!list) return
      setBrands(list)
      const b = norm(brand)
      const match = list.find((x) => norm(x.name) === b) || list.find((x) => norm(x.name).startsWith(b) || b.startsWith(norm(x.name)))
      if (match) setBrandCode(match.code)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 2) Modelos da marca
  useEffect(() => {
    setModels([]); setModelCode(''); setYears([]); setYearCode(''); setPrice(null)
    if (!brandCode) return
    let current = true
    void get<Item[]>(`/brands/${brandCode}/models`, 'modelos').then((list) => list && current && setModels(list))
    return () => { current = false }
  }, [brandCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const words = useMemo(() => norm(query).split(' ').filter(Boolean), [query])
  const ranked = useMemo(() => {
    const scored = models.map((m) => ({ ...m, s: score(m.name, words, hints) }))
    const best = scored.filter((m) => m.s > 0).sort((a, b) => b.s - a.s || a.name.localeCompare(b.name))
    return (best.length ? best : scored).slice(0, 60)
  }, [models, words, hints])

  // Pré-seleciona o modelo mais parecido
  useEffect(() => {
    if (!modelCode && ranked[0] && ranked[0].s > 0) setModelCode(ranked[0].code)
  }, [ranked]) // eslint-disable-line react-hooks/exhaustive-deps

  // 3) Anos do modelo; escolhe o ano/combustível do carro
  useEffect(() => {
    setYears([]); setYearCode(''); setPrice(null)
    if (!brandCode || !modelCode) return
    let current = true
    void get<Item[]>(`/brands/${brandCode}/models/${modelCode}/years`, 'anos').then((list) => {
      if (!list || !current) return
      setYears(list)
      const sameYear = list.filter((y) => y.code.startsWith(`${year}-`))
      const match = sameYear.find((y) => norm(y.name).includes(norm(fuel))) || sameYear[0]
      if (match) setYearCode(match.code)
    })
    return () => { current = false }
  }, [brandCode, modelCode]) // eslint-disable-line react-hooks/exhaustive-deps

  // 4) Preço
  useEffect(() => {
    setPrice(null)
    if (!brandCode || !modelCode || !yearCode) return
    let current = true
    void get<Price>(`/brands/${brandCode}/models/${modelCode}/years/${yearCode}`, 'preço').then((p) => p && current && setPrice(p))
    return () => { current = false }
  }, [yearCode]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fipe-lookup" role="group" aria-label="Consulta à tabela FIPE">
      <div className="fipe-head">
        <strong>Consultar tabela FIPE</strong>
        <button type="button" className="fipe-close" onClick={onClose} aria-label="Fechar consulta FIPE"><X size={16} /></button>
      </div>
      <div className="fipe-grid">
        <label className="admin-field">
          <span>Marca</span>
          <select value={brandCode} onChange={(e) => { setBrandCode(e.target.value); setModelCode('') }}>
            <option value="">{brands.length ? 'Selecione' : 'Carregando…'}</option>
            {brands.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
        </label>
        <label className="admin-field">
          <span>Buscar modelo</span>
          <div className="fipe-search"><Search size={14} /><input value={query} onChange={(e) => { setQuery(e.target.value); setModelCode('') }} placeholder="Ex.: Corolla GLi 1.8" /></div>
        </label>
        <label className="admin-field wide">
          <span>Modelo na FIPE {models.length > 0 && <small>({ranked.length} de {models.length})</small>}</span>
          <select value={modelCode} onChange={(e) => setModelCode(e.target.value)} disabled={!models.length}>
            <option value="">{brandCode ? (models.length ? 'Selecione o modelo' : 'Carregando…') : 'Escolha a marca'}</option>
            {ranked.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </select>
        </label>
        <label className="admin-field">
          <span>Ano / combustível</span>
          <select value={yearCode} onChange={(e) => setYearCode(e.target.value)} disabled={!years.length}>
            <option value="">{modelCode ? (years.length ? 'Selecione' : 'Carregando…') : 'Escolha o modelo'}</option>
            {years.map((y) => <option key={y.code} value={y.code}>{yearLabel(y.name)}</option>)}
          </select>
        </label>
        <div className="fipe-result" aria-live="polite">
          {busy ? (
            <span className="perf-muted">Consultando {busy}…</span>
          ) : price ? (
            <>
              <strong>{brl(price.price)}</strong>
              <small>{price.reference} · código {price.code}</small>
            </>
          ) : (
            <span className="perf-muted">Selecione modelo e ano</span>
          )}
        </div>
      </div>
      {error && <p className="fipe-error" role="alert">{error}</p>}
      <div className="fipe-actions">
        <button type="button" className="admin-primary" disabled={!price} onClick={() => price && onApply({ fipe: price.price, fipeCode: price.code, fipeReference: price.reference })}>
          <Check size={16} /> Usar este valor
        </button>
        <small className="perf-muted">Fonte: Tabela FIPE (Parallelum). Confira o modelo antes de usar.</small>
      </div>
    </div>
  )
}
