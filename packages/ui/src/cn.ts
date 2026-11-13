import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Fusionne des classes Tailwind ; la dernière l'emporte en cas de conflit. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
