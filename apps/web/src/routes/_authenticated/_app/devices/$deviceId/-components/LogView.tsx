import { cn } from '@rpi-control-center/ui'
import * as React from 'react'

/** Keeps a scrolling element at the bottom as `content` grows, unless the reader scrolled up. */
export function useStickToBottom<E extends HTMLElement>(content: unknown) {
  const ref = React.useRef<E>(null)
  const stick = React.useRef(true)

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll again whenever the content changes
  React.useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [content])

  const onScroll = React.useCallback((event: React.UIEvent<E>) => {
    const el = event.currentTarget
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }, [])

  return { ref, onScroll }
}

/**
 * Monospaced console lines that stay scrolled to the bottom unless you scroll
 * up. A full-width band, flat like the rest of the page.
 */
export function LogView({
  lines,
  empty,
  className,
}: {
  lines: string[]
  empty?: React.ReactNode
  className?: string
}) {
  const { ref, onScroll } = useStickToBottom<HTMLPreElement>(lines)
  return (
    <pre
      ref={ref}
      onScroll={onScroll}
      className={cn(
        'overflow-auto bg-muted/40 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words',
        className,
      )}
    >
      {lines.length ? lines.join('\n') : <span className="text-muted-foreground">{empty}</span>}
    </pre>
  )
}
