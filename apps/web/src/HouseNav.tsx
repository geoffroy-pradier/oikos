import { cn, PILL_LIST, pillClass } from '@oikos/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';
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
 * l'écran ouvert est plein et porte `aria-current`. Trop large pour un téléphone, la gélule défile : chaque
 * écran a la sienne, qui s'ouvre centrée sur la pastille de l'écran, sans faire défiler la page.
 */
export function HouseNav({ className }: { className?: string }) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const list = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = list.current;
    const center = () => {
      const here = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!nav || !here) return;
      const offset = here.getBoundingClientRect().left - nav.getBoundingClientRect().left;
      nav.scrollLeft += offset - (nav.clientWidth - here.offsetWidth) / 2;
    };
    center();
    // Police chargée après ce rendu : les pastilles changent de largeur, la gélule se recentre.
    void document.fonts?.ready.then(center);
  }, [pathname]);
  return (
    <nav
      ref={list}
      aria-label={t('home.sectionsNav')}
      className={cn(PILL_LIST, 'self-start', className)}
    >
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
