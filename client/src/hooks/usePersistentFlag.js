import { useCallback, useEffect, useState } from 'react'

/**
 * Read initial boolean flag value from localStorage
 * @param {string} key - localStorage key
 * @param {boolean} defaultValue - Default value if not found
 * @returns {boolean} The stored value or default
 */
function readInitialValue(key, defaultValue) {
  if (typeof window === 'undefined') return defaultValue
  try {
    const stored = window.localStorage.getItem(key)
    if (stored === null) {
      window.localStorage.setItem(key, defaultValue ? '1' : '0')
      return defaultValue
    }
    return stored === '1'
  } catch (error) {
    console.warn('[usePersistentFlag] unable to access localStorage', error)
    return defaultValue
  }
}

/**
 * Hook to manage a boolean flag persisted in localStorage
 * Automatically syncs changes to localStorage
 *
 * @param {string} key - localStorage key for the flag
 * @param {boolean} defaultValue - Default value if not found
 * @returns {Object} Flag value, setter, and toggle function
 */
export function usePersistentFlag(key, defaultValue = false) {
  const [value, setValue] = useState(() => readInitialValue(key, defaultValue))

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
