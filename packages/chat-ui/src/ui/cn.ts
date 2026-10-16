import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 与宿主 `@/lib/utils` 的 `cn` 同实现（包内相对实现，避免依赖宿主别名）。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
