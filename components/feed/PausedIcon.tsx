// The play icon centered over the card the user paused (§5.1.1). Pointer-transparent so the next tap
// reaches the feed. `top` places it over the active card, the way the pooled videos are placed.
export default function PausedIcon({ top }: { top: string }) {
  return (
    <div
      data-testid="paused-icon"
      role="img"
      aria-label="Paused"
      className="pointer-events-none absolute inset-x-0 z-[4] flex h-full items-center justify-center"
      style={{ top }}
    >
      <span className="flex size-20 items-center justify-center rounded-full bg-black/45 text-white">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5Z" />
        </svg>
      </span>
    </div>
  );
}
