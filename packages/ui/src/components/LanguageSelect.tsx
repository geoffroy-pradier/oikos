import { ChevronDown, Languages } from 'lucide-react';
import { useId } from 'react';
import { cn } from '../cn';

export interface LanguageSelectProps {
  /** Codes des langues proposées, dans l'ordre d'affichage. */
  languages: readonly string[];
  value: string;
  onChange: (language: string) => void;
  /** Nom accessible (« Langue »), déjà traduit ; lu par les lecteurs d'écran, pas affiché. */
  label: string;
  /** Nom de chaque langue, déjà traduit. */
  nameOf: (language: string) => string;
  /** Sans l'icône, à toute largeur : pour une colonne étroite (barre latérale d'Olympe). */
  compact?: boolean;
  className?: string;
}

/**
 * Choix de la langue dans l'en-tête, partagé par le jeu et Olympe : une pastille stylée par les jetons, sur une liste
 * native (clavier et lecteurs d'écran du système). L'icône des langues la précède à partir de 640 px ; sur téléphone,
 * la place va à la marque. Chaque langue se nomme dans sa propre langue (`lang`).
 */
export function LanguageSelect({
  languages,
  value,
  onChange,
  label,
  nameOf,
  compact = false,
  className,
}: LanguageSelectProps) {
  const id = useId();
  return (
    <div className={cn('relative inline-flex min-w-0', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {!compact && (
        <Languages
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 hidden size-4 -translate-y-1/2 text-foreground-secondary sm:block"
        />
      )}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'min-h-11 w-full min-w-0 cursor-pointer appearance-none rounded-full border border-border bg-surface-raised',
          'pr-9 pl-3.5 text-sm font-medium text-foreground shadow-sm',
          !compact && 'sm:pl-9',
          'transition-colors duration-(--motion-fast) ease-out hover:bg-muted',
        )}
      >
        {languages.map((language) => (
          <option key={language} value={language} lang={language}>
            {nameOf(language)}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-foreground-secondary"
      />
    </div>
  );
}
