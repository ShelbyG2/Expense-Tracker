'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'

// Minimal toast system: the provider lives in the protected layout, so a
// toast fired just before router.push() is still on screen after navigation.

type Toast = { id: number; message: string; tone: 'success' | 'error' }

type ToastContextValue = {
  toast: (message: string, tone?: Toast['tone']) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const toast = useCallback(
    (message: string, tone: Toast['tone'] = 'success') => {
      const id = nextId.current++
      setToasts((prev) => [...prev, { id, message, tone }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 4000)
    },
    [],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* aria-live region so success messages reach screen readers. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={
              t.tone === 'error'
                ? 'pointer-events-auto rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-300'
                : 'pointer-events-auto rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-800 shadow-lg dark:border-green-900 dark:bg-green-950 dark:text-green-300'
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
