import { useState, useEffect, useCallback } from 'react'
import { TAB_IDS } from '../constants/config.js'

const STORAGE_KEY = 'bello:activeTab'

/**
 * Custom hook to manage active tab state with localStorage persistence
 * @param {string} [defaultTab=TAB_IDS.OUTLINE] - Default tab to show
 * @returns {Object} Active tab state and setters
 */
export function useActiveTab(defaultTab = TAB_IDS.OUTLINE) {
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || defaultTab
    } catch {
      return defaultTab
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, activeTab)
    } catch {}
  }, [activeTab])

  const isTab = useCallback((id) => activeTab === id, [activeTab])

  return { activeTab, setActiveTab, isTab }
}

