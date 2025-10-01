import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ReminderProvider } from './context/ReminderContext.jsx'

function renderApp() {
  const container = document.getElementById('root')
  if (!container) {
    throw new Error('Failed to find root element')
  }

  const root = createRoot(container)
  root.render(
    <ReminderProvider>
      <App />
    </ReminderProvider>
  )
}

renderApp()
