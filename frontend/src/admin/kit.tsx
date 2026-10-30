import { useEffect, useState, type ReactNode } from 'react'
import { request } from './api'

// Peças compartilhadas pelos módulos do Dunna: campos, avisos, formatação e carregamento com recarga.
export const messageOf = (e: unknown) => e instanceof Error ? e.message : 'Ocorreu um erro. Tente novamente.'
export const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
export const moneyFull = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const compact = (c: number) => { const v = c / 100; return Math.abs(v) >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : Math.abs(v) >= 1e3 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : money(c) }
export const dateBR = (iso: string) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
export const monthLabel = (ym: string) => `${new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 15)).toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '')}/${ym.slice(2, 4)}`
/** Converte "1.234,56" ou "1234.56" em centavos; NaN quando inválido. */
export const toCents = (s: string) => { const t = s.trim().replace(/[R$\s]/g, ''); const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? Math.round(n * 100) : NaN }
export const centsInput = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) { return <label className={`admin-field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}</label> }
export function Notice({ children }: { children: ReactNode }) { return <div className="admin-notice" role="alert">{children}</div> }
export function Delta({ value, suffix = '%', invert = false }: { value: number | null; suffix?: string; invert?: boolean }) {
 if (value === null || value === undefined) return <span className="dn-delta neutral">sem base anterior</span>
 const good = invert ? value < 0 : value > 0
 return <span className={`dn-delta ${value === 0 ? 'neutral' : good ? 'up' : 'down'}`}>{value > 0 ? '▲' : value < 0 ? '▼' : '■'} {Math.abs(value).toLocaleString('pt-BR')}{suffix}</span>
}

/** Carrega um recurso da loja e recarrega quando a loja ou `deps` mudam. */
export function useResource<T>(route: string, storeId: string, deps: unknown[] = []) {
 const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [tick, setTick] = useState(0)
 useEffect(() => { let active = true; setError(''); request<T>(route, {}, storeId).then(r => { if (active) setData(r) }).catch(e => { if (active) setError(messageOf(e)) }); return () => { active = false } }, [route, storeId, tick, ...deps])
 return { data, error, reload: () => setTick(n => n + 1), setData }
}
