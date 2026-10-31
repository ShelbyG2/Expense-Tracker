'use client'

import { useSyncExternalStore } from 'react'

// Light/dark toggle. The choice is stored in localStorage and applied before
// hydration by the inline script in app/layout.tsx, so there is no flash.
// Theme state is read from the DOM (not React state) via useSyncExternalStore,
// with a MutationObserver keeping it in sync when the class changes.

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  return () => observer.disconnect()
}

function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false)

  function toggle() {
    const next = !isDark()
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      // Storage may be unavailable (private mode); the class still applies.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="rounded-md border border-neutral-200 p-1.5 text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      {dark ? (
        // Sun (currently dark -> click for light)
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // Moon (currently light -> click for dark)
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  )
}
