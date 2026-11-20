import { Compass, House } from '@oikos/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/** Adresse inconnue : le dire dans la présentation des écrans vides, et ramener à la maison. */
export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border-subtle bg-surface px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="grid size-16 place-items-center rounded-full bg-primary-subtle text-primary [&_svg]:size-8"
      >
        <Compass />
      </span>
      <h1 className="text-[1.625rem] leading-tight font-bold">{t('shell.notFound')}</h1>
      <p className="max-w-prose text-muted-foreground">{t('shell.notFoundHint')}</p>
      <Link
        to="/"
        className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 font-medium text-primary-foreground transition-colors duration-(--motion-fast) hover:bg-primary-hover"
      >
        <House aria-hidden="true" className="size-[1.15em]" />
        {t('shell.backHome')}
      </Link>
    </div>
  );
}
