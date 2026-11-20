import { ChevronDown, CircleHelp, cn } from '@oikos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Aide repliée (#869) : l'explication d'un écran ou d'une section tient en une ligne, « Comment ça marche ? »,
 * qui l'ouvre au clavier comme à la souris. Le texte reste dans la page : la recherche du navigateur le trouve.
 */
export function Help({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useTranslation();
  return (
    <details className={cn('group text-sm', className)}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md font-medium text-foreground-secondary hover:text-primary [&::-webkit-details-marker]:hidden">
        <CircleHelp aria-hidden="true" className="size-4 shrink-0 text-accent" />
        {t('app.help')}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-(--motion-fast) group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <p className="max-w-prose pb-1 text-muted-foreground">{children}</p>
    </details>
  );
}
