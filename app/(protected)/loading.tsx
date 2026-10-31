// Loading state shown while a protected page streams its data.
export default function Loading() {
  return (
    <div
      className="flex min-h-[50vh] items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-7 w-7 animate-spin text-neutral-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M12 3a9 9 0 1 0 9 9" />
      </svg>
      <span className="sr-only">Loading…</span>
    </div>
  )
}
