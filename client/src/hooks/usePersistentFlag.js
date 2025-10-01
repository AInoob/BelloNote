import { useCallback, useEffect, useState } from 'react'

const STORAGE_TRUE = '1'
const STORAGE_FALSE = '0'

function readFlag(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const stored = window.localStorage.getItem(key)
    if (stored === null) {
      window.localStorage.setItem(key, fallback ? STORAGE_TRUE : STORAGE_FALSE)
      return fallback
    }
    return stored === STORAGE_TRUE
  } catch (error) {
    console.warn('[usePersistentFlag] unable to access localStorage', error)
    return fallback
  }
}

function writeFlag(key, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value ? STORAGE_TRUE : STORAGE_FALSE)
  } catch (error) {
    console.warn('[usePersistentFlag] failed to persist flag', error)
  }
}

export function usePersistentFlag(key, defaultValue = false) {
  const [value, setValue] = useState(() => readFlag(key, defaultValue))

  useEffect(() => {
    writeFlag(key, value)
  }, [key, value])

  const toggle = useCallback(() => {
    setValue((current) => !current)
  }, [])

  return { value, setValue, toggle }
}
