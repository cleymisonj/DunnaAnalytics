import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const brl = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** Valor em centavos formatado com centavos (financeiro). */
export const cents = (value: number) =>
  (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
