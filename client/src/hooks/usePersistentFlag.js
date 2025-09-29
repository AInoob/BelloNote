import { useCallback, useEffect, useState } from 'react'

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
