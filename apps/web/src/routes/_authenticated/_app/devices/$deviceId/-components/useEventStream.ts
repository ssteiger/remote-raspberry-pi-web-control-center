import * as React from 'react'

export type StreamState = 'connecting' | 'live' | 'error' | 'paused'

const MAX_ITEMS = 2000

/**
 * Follows a server-sent events URL while `url` is set and not paused, keeping
 * the newest items. The server replays recent history on every (re)connect,
 * so items start over then. `failure` events stop the stream; `notice`
 * events are collected separately. Pass a `parse` defined outside the
 * component, or a new one reconnects on every render.
 */
export function useEventStream<T>(url: string | null, parse: (data: string) => T | null) {
  const [items, setItems] = React.useState<{ id: number; value: T }[]>([])
  const [connection, setConnection] = React.useState<Exclude<StreamState, 'paused'>>('connecting')
  const [error, setError] = React.useState<string | null>(null)
  const [notices, setNotices] = React.useState<string[]>([])
  const [paused, setPaused] = React.useState(false)

  React.useEffect(() => {
    if (paused || !url) return
    const source = new EventSource(url)
    let nextId = 0
    const onFailure = (event: Event) => {
      setError((event as MessageEvent<string>).data)
      setConnection('error')
      source.close()
    }
    const onNotice = (event: Event) => {
      const text = (event as MessageEvent<string>).data
      setNotices((current) => (current.includes(text) ? current : [...current, text]))
    }
    source.onopen = () => {
      setItems([])
      setNotices([])
      setError(null)
      setConnection('live')
    }
    source.onmessage = (event: MessageEvent<string>) => {
      const value = parse(event.data)
      if (value === null) return
      setItems((current) => {
        const next = [...current, { id: nextId++, value }]
        return next.length > MAX_ITEMS ? next.slice(-MAX_ITEMS) : next
      })
    }
    source.onerror = () => {
      // EventSource reconnects on its own; say so while it does.
      setConnection((current) => (current === 'error' ? current : 'connecting'))
    }
    source.addEventListener('failure', onFailure)
    source.addEventListener('notice', onNotice)
    return () => {
      source.removeEventListener('failure', onFailure)
      source.removeEventListener('notice', onNotice)
      source.close()
    }
  }, [url, paused, parse])

  return {
    items,
    state: (paused ? 'paused' : connection) as StreamState,
    error,
    notices,
    paused,
    togglePaused: () => setPaused((p) => !p),
    clear: () => setItems([]),
  }
}
