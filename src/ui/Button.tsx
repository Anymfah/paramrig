import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'solid' | 'ghost' | 'quiet'
type Size = 'sm' | 'md'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  icon?: ReactNode
}

export function Button({ variant = 'solid', size = 'md', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={`btn btn--${variant} btn--${size} ${className ?? ''}`.trim()} {...rest}>
      {children}
      {icon}
    </button>
  )
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  variant?: Variant
}

export function IconButton({
  label,
  variant = 'ghost',
  className,
  children,
  type = 'button',
  disabled,
  onClick,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={`icon-btn icon-btn--${variant} ${className ?? ''}`.trim()}
      aria-label={label}
      aria-disabled={disabled || undefined}
      {...rest}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
    >
      {children}
    </button>
  )
}
