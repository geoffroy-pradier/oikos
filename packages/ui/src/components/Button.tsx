import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium select-none ' +
    'transition-[background-color,border-color,box-shadow,transform] duration-(--motion-fast) ease-out ' +
    'enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 ' +
    '[&_svg]:size-[1.15em] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Reflet discret en haut du bouton ; le survol prend une teinte dont le contraste est vérifié.
        primary:
          'bg-primary bg-linear-to-b from-white/10 to-transparent text-primary-foreground shadow-sm ' +
          'enabled:hover:bg-primary-hover enabled:hover:shadow-md',
        secondary:
          'border border-border bg-surface-raised text-foreground shadow-sm enabled:hover:bg-muted',
        ghost: 'text-foreground enabled:hover:bg-muted',
        danger:
          'border border-danger/40 bg-danger-subtle text-danger enabled:hover:border-danger ' +
          'enabled:hover:shadow-sm',
      },
      // Cibles tactiles d'au moins 44 px de haut ; `sm` est réservé aux tableaux denses sur ordinateur.
      size: {
        sm: 'min-h-9 px-3 text-sm',
        md: 'min-h-11 px-4 text-base',
        lg: 'min-h-12 px-6 text-lg',
        icon: 'size-11 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Icône placée avant le libellé, décorative. Avec `size="icon"`, nommer le bouton par `aria-label`. */
    icon?: ReactNode;
    /** Commande en cours : bouton inactif, marqué occupé, libellé inchangé. */
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  icon,
  loading = false,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
