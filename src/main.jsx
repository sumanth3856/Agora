import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { SimulationProvider } from './SimulationContext.jsx'
import { AuthProvider } from './AuthContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <SimulationProvider>
        <App />
      </SimulationProvider>
    </AuthProvider>
  </StrictMode>,
)
