import React, { useEffect, useRef, useState } from 'react'

export default function LazyMount({ rootMargin = '400px', children, once = true }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true)
        if (once) io.disconnect()
      } else if (!once) {
        setVisible(false)
      }
    }, { root: null, rootMargin, threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [once, rootMargin])

  return <div ref={ref}>{visible ? children : null}</div>
}
