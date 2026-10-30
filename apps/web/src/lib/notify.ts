import { toast } from 'sonner'

type NotifyLevel = 'success' | 'error'

interface NotifyOptions {
  description?: string
  action?: { label: string; onClick: () => void }
}

/** The same level, text and description never stack: showing it again restarts its timer. */
function show(level: NotifyLevel, message: string, options: NotifyOptions = {}): void {
  const id = [level, message, options.description].filter(Boolean).join(':')
  toast[level](message, { ...options, id, duration: level === 'error' ? 6000 : 4000 })
}

export const notify = {
  success: (message: string, options?: NotifyOptions) => show('success', message, options),
  error: (message: string, options?: NotifyOptions) => show('error', message, options),
}
