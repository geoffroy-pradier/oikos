import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../cn';
import { TOUCH_TARGET } from './field-parts';

const buttonVariants = cva(
  `${TOUCH_TARGET} inline-flex items-center justify-center gap-2 rounded-md font-medium select-none ` +
    'transition-[background-color,border-color,box-shadow,transform] duration-(--motion-fast) ease-out ' +
    'enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 ' +
    '[&_svg]:size-[1.15em] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Principal plein ; le survol prend une teinte dont le contraste est vérifié.
        primary: 'bg-primary text-primary-foreground shadow-sm enabled:hover:bg-primary-hover',
        secondary:
          'border border-border bg-surface-raised text-foreground shadow-sm enabled:hover:bg-muted',
        // Discret : sans fond ni bordure tant qu'on ne le survole pas.
        ghost: 'text-foreground enabled:hover:bg-muted',
        danger:
          'border border-danger/40 bg-danger-subtle text-danger enabled:hover:border-danger ' +
          'enabled:hover:shadow-sm',
      },
      // 40 px visibles, 44 px de cible (`TOUCH_TARGET`) ; `sm` est réservé aux tableaux denses sur ordinateur.
      size: {
        sm: 'min-h-9 px-3 text-sm',
        md: 'min-h-10 px-4 text-[0.9375rem]',
        lg: 'min-h-12 px-6 text-base',
        icon: 'size-10 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Icône placée avant le libellé, décorative. Sans libellé, employer `IconButton`. */
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

export type IconButtonProps = Omit<ButtonProps, 'size' | 'children' | 'aria-label' | 'icon'> & {
  /** Nom accessible, déjà traduit : obligatoire, il sert aussi d'infobulle. */
  label: string;
  icon: ReactNode;
};

/** Bouton carré d'une seule icône, discret par défaut. */
export function IconButton({ label, icon, variant = 'ghost', ...props }: IconButtonProps) {
  return (
    <Button {...props} variant={variant} size="icon" icon={icon} aria-label={label} title={label} />
  );
}
