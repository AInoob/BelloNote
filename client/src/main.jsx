import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ReminderProvider } from './context/ReminderContext.jsx'

function Root() {
  return (
    <ReminderProvider>
      <App />
    </ReminderProvider>
  )
}

const container = document.getElementById('root')
if (!container) {
  throw new Error('Failed to find root element')
}

createRoot(container).render(<Root />)
