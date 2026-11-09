/** Marca Dunna Analytics: símbolo "D" com barras (public/brand) e nome em texto, para ficar nítido em qualquer tamanho. */
export function DunnaMark({size=36}:{size?:number}) {
 return <img src="/brand/dunna-mark.png" alt="" width={size} height={Math.round(size*0.82)} className="dunna-mark"/>
}
export function DunnaLogo({compact=false}:{compact?:boolean}) {
 return <span className="dunna-logo" aria-label="Dunna Analytics"><DunnaMark/>{!compact&&<span className="dunna-word"><strong>DUNNA</strong><small>ANALYTICS</small></span>}</span>
}
/** Logotipo completo, com o slogan, para a tela de entrada. */
export function DunnaLockup() {
 return <img src="/brand/dunna-logo.png" alt="Dunna Analytics · Inteligência em performance automotiva" className="dunna-lockup" width={450} height={115}/>
}
