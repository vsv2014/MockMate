import * as React from 'react'
import { cn } from '../lib/cn'

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text',
        'placeholder:text-text-subtle',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-transparent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'transition-colors',
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = 'Input'

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[120px] w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text',
        'placeholder:text-text-subtle',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-transparent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'transition-colors resize-y',
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = 'Textarea'

export { Input, Textarea }
