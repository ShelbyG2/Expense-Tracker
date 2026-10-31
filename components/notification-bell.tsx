'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/toast'
import { NotificationIcon } from '@/components/notification-icon'
import type { NotificationType } from '@/lib/constants'

type Notification = {
  id: string
  type: NotificationType
  message: string
  link: string
  readAt: string | null
  createdAt: string
}

export function NotificationBell({
  unreadCount,
  latest,
}: {
  unreadCount: number
  latest: Notification[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>(latest)
  const [unread, setUnread] = useState(unreadCount)
  const [loaded, setLoaded] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch('/api/notifications?pageSize=10', {
          credentials: 'include',
        })
        if (!res.ok) return
        const data = (await res.json()) as {
          items?: Notification[]
          unreadCount?: number
        }
        if (cancelled) return
        if (data.items) setItems(data.items)
        // The list endpoint reports the total so the badge follows the server.
        if (typeof data.unreadCount === 'number') setUnread(data.unreadCount)
        setLoaded(true)
      } catch {
        /* ignore network errors in the dropdown */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (panelRef.current && target && !panelRef.current.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function markRead(id: string) {
    const res = await fetch('/api/notifications', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    })
    if (!res.ok) return
    setItems((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, readAt: new Date().toISOString() } : it,
      ),
    )
    setUnread((prev) => Math.max(0, prev - 1))
  }

  async function markAll() {
    setOpen(false)
    const res = await fetch('/api/notifications', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    if (!res.ok) {
      toast('Could not mark all as read', 'error')
      return
    }
    const data = (await res.json()) as { updatedCount?: number }
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        readAt: it.readAt ?? new Date().toISOString(),
      })),
    )
    setUnread(0)
    toast(`Marked ${data.updatedCount ?? 0} notifications as read`)
  }

  function openNotification(id: string, href: string) {
    void markRead(id)
    setOpen(false)
    router.push(href)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
      >
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-medium text-white"
            aria-label={`${unread} unread`}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 z-50 mt-2 w-80 origin-top-right rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Notifications
            </span>
            <button
              type="button"
              onClick={markAll}
              className="text-sm font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              Mark all as read
            </button>
          </div>
          {!loaded && (
            <div className="px-4 py-6 text-center text-sm text-neutral-500">
              Loading…
            </div>
          )}
          {loaded && items.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-neutral-500">
              No notifications yet.
            </div>
          )}
          {loaded && items.length > 0 && (
            <ul className="max-h-[400px] overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(item.id, item.link)}
                    className={`flex w-full items-start gap-3 rounded-md px-4 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60 ${
                      item.readAt === null
                        ? 'bg-neutral-50/70 dark:bg-neutral-800/40'
                        : ''
                    }`}
                  >
                    <span className="mt-0.5 shrink-0">
                      <NotificationIcon name={item.type} />
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-neutral-900 dark:text-neutral-100">
                        {item.message}
                      </span>
                      <time
                        dateTime={item.createdAt}
                        className="truncate text-xs text-neutral-500"
                      >
                        {new Date(item.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-neutral-200 px-4 py-2 text-center text-sm dark:border-neutral-800">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="font-medium text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
            >
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
