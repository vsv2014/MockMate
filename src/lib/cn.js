import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes without conflicts — shadcn/ui standard */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
