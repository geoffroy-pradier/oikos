import { cn, PILL_LIST, pillClass } from '@oikos/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/** Rubriques de l'onglet Maison, dans l'ordre des pastilles. */
const SECTIONS = [
  { id: 'overview', to: '/' },
  { id: 'sites', to: '/sites' },
  { id: 'staff', to: '/personnel' },
  { id: 'property', to: '/immobilier' },
  { id: 'accounts', to: '/comptes' },
] as const;

/**
 * Sous-sections de l'onglet Maison en pastilles (ADR 0011) : des liens, chacun vers son écran ; celui de
 * l'écran ouvert est plein et porte `aria-current`. Trop large pour un téléphone, la gélule défile.
 */
export function HouseNav({ className }: { className?: string }) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav aria-label={t('home.sectionsNav')} className={cn(PILL_LIST, 'self-start', className)}>
      {SECTIONS.map((section) => {
        const current = pathname === section.to;
        return (
          <Link
            key={section.id}
            to={section.to}
            aria-current={current ? 'page' : undefined}
            activeOptions={{ exact: true, includeSearch: false }}
            className={pillClass(current)}
          >
            {t(`home.nav.${section.id}`)}
          </Link>
        );
      })}
    </nav>
  );
}
