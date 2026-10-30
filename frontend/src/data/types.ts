export type Brand = string
export type Body = 'SUV' | 'Sedan' | 'Hatch' | 'Picape'
export type Fuel = 'Flex' | 'Gasolina' | 'Diesel' | 'Híbrido' | 'Elétrico'
export type Badge = 'Abaixo da FIPE' | 'Único Dono' | 'Destaque' | 'Recém Chegado'

export interface Vehicle {
  description?: string
  status?: 'available' | 'reserved' | 'sold' | 'draft'
  id: string
  brand: Brand
  model: string
  version: string
  /** Ano do modelo (usado em filtros e ordenação) */
  year: number
  /** Ano de fabricação */
  yearMade: number
  price: number
  /** Valor da tabela FIPE, quando informado pela loja */
  fipe?: number
  mileage: number
  transmission: 'Automático' | 'Manual' | 'Automatizado'
  fuel: Fuel
  body: Body
  color: string
  badge?: Badge
  condition: 'Novo' | 'Seminovo'
  armored?: boolean
  images: string[]
  specs: { label: string; value: string }[]
  options: string[]
  /** Consultor responsável (a vitrine recebe só o nome) */
  seller?: { name: string }
}

export type Tab = 'todos' | 'automaticos' | 'suvs' | 'ate-60'
export type PriceRange = 'all' | 'ate50' | '50-80' | '80-120' | '120+'
/** Categoria inclui o agrupamento visual "Eletrificados" (híbridos + elétricos). */
export type Category = Body | 'Eletrificado'

/** Ano no formato da loja: fabricação/modelo (ex.: 2014/2015). */
export const yearLabel = (v: Pick<Vehicle, 'year' | 'yearMade'>) => `${v.yearMade}/${v.year}`

export interface Filters {
  tab: Tab
  brand: Brand | 'all'
  query: string
  category: Category | 'all'
  price: PriceRange
  minYear: number | 'all'
}

export const DEFAULT_FILTERS: Filters = {
  tab: 'todos',
  brand: 'all',
  query: '',
  category: 'all',
  price: 'all',
  minYear: 'all',
}
