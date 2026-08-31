export function StatusMessage({ children, tone = 'info' }: { children: string; tone?: 'info' | 'error' | 'ok' }) {
  return (
    <p className={`status-msg status-msg--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  )
}
