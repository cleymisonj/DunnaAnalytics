/** Marca Dunna Analytics: monograma "D" com barras de gráfico e o nome ao lado. */
export function DunnaMark({size=34}:{size?:number}) {
 return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="dunna-mark"><rect width="64" height="64" rx="14" fill="#4f46e5"/><path d="M18 14h13c11 0 19 7.6 19 18s-8 18-19 18H18z" fill="none" stroke="#fff" strokeWidth="6"/><path d="M27 40V30M34 40V24M41 40v-6" stroke="#a5b4fc" strokeWidth="4" strokeLinecap="round"/></svg>
}
export function DunnaLogo({compact=false}:{compact?:boolean}) {
 return <span className="dunna-logo" aria-label="Dunna Analytics"><DunnaMark/>{!compact&&<span className="dunna-word"><strong>dunna</strong><small>ANALYTICS</small></span>}</span>
}
