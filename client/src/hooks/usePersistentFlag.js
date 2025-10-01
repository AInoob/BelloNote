import { useCallback, useEffect, useState } from 'react'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reads the initial value of a flag from localStorage
 * @param {string} key - The localStorage key
 * @param {boolean} defaultValue - Default value if not found
 * @returns {boolean} The stored value or default
 */
function readInitialValue(key, defaultValue) {
  if (typeof window === 'undefined') return defaultValue

  try {
    const stored = window.localStorage.getItem(key)

    if (stored === null) {
      // Initialize with default value
      window.localStorage.setItem(key, defaultValue ? '1' : '0')
      return defaultValue
    }

    return stored === '1'
  } catch (error) {
    console.warn('[usePersistentFlag] unable to access localStorage', error)
    return defaultValue
  }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook that manages a boolean flag persisted in localStorage
 * @param {string} key - The localStorage key to use
 * @param {boolean} [defaultValue=false] - Default value if not stored
 * @returns {Object} Object with value, setValue, and toggle functions
 */
export function usePersistentFlag(key, defaultValue = false) {
  const [value, setValue] = useState(() => readInitialValue(key, defaultValue))

  // Persist to localStorage whenever value changes
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      window.localStorage.setItem(key, value ? '1' : '0')
    } catch (error) {
      console.warn('[usePersistentFlag] failed to persist flag', error)
    }
  }, [key, value])

  const toggle = useCallback(() => {
    setValue((current) => !current)
  }, [])

  return { value, setValue, toggle }
}
