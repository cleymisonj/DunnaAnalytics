import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import Admin from './admin/Admin'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Admin />
    </MotionConfig>
  </StrictMode>,
)
