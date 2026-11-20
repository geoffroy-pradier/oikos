import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { cn } from '../cn';
import { Button } from './Button';

export interface Step {
  id: string;
  title: string;
  content: ReactNode;
  /** `false` tant que la saisie de l'étape n'est pas valable : Continuer reste inactif. */
  valid?: boolean;
  /**
   * Appelé avant de quitter l'étape par Continuer ou Entrée ; `false` la garde, l'écran ayant affiché
   * pourquoi. Pour une saisie dont le refus doit s'expliquer, ce que `valid` (bouton inactif) ne fait pas.
   */
  check?: () => boolean;
}

export interface StepperProps {
  /** La dernière étape est le récapitulatif chiffré, confirmé par `onConfirm`. */
  steps: readonly Step[];
  onConfirm: () => void;
  /** Étape par laquelle commencer (identifiant) : l'écran qui doit ramener le joueur à une étape remonte le Stepper. */
  initialStep?: string | undefined;
  /** Commande en cours : Confirmer est marqué occupé. */
  confirming?: boolean;
  /** Identifiant de ce qui décrit Confirmer (le net attendu d'une vente), lu en arrivant sur le bouton. */
  confirmDescribedBy?: string | undefined;
  labels: {
    /** Nom de la barre d'étapes (« Étapes »). */
    progress: string;
    back: string;
    next: string;
    confirm: string;
    /** « Étape 2 sur 3 ». */
    stepOf: (current: number, total: number) => string;
  };
}

/**
 * Action à plusieurs étapes (ADR 0011) : barre de segments, étape courante annoncée
 * (`aria-current="step"`, foyer sur son titre), Retour et Continuer en bas. Les étapes passées restent
 * montées, cachées : revenir en arrière ne perd aucune saisie.
 */
export function Stepper({
  steps,
  onConfirm,
  initialStep,
  confirming = false,
  confirmDescribedBy,
  labels,
}: StepperProps) {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      steps.findIndex((s) => s.id === initialStep),
    ),
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  const wasConfirming = useRef(confirming);
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [index]);
  // Inactif pendant la commande, Confirmer a perdu le foyer ; resté là après un refus, il le retrouve
  // (spécification 10, Exigences) : Entrée renvoie la même demande.
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (wasConfirming.current && !confirming && lost) confirmButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const go = (next: number) => {
    moved.current = true;
    setIndex(next);
  };
  const advance = () => {
    if (step?.valid === false || step?.check?.() === false) return;
    if (last) onConfirm();
    else go(index + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Étapes nommées (#869) : chaque segment porte le titre de son étape, abrégé s'il manque de place. */}
      <ol aria-label={labels.progress} className="flex gap-1.5">
        {steps.map((item, i) => (
          <li
            key={item.id}
            aria-current={i === index ? 'step' : undefined}
            className="flex min-w-0 flex-1 flex-col gap-1"
          >
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 rounded-full transition-colors duration-(--motion-base)',
                i <= index ? 'bg-primary' : 'bg-muted',
              )}
            />
            <span
              className={cn(
                'truncate text-xs',
                i === index ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {item.title}
            </span>
          </li>
        ))}
      </ol>
      <h3 ref={heading} tabIndex={-1} className="flex flex-col gap-0.5 text-lg">
        <span className="text-xs font-medium text-muted-foreground">
          {labels.stepOf(index + 1, steps.length)}
        </span>{' '}
        {step?.title}
      </h3>
      {steps.map((item, i) => (
        <div
          key={item.id}
          hidden={i !== index}
          className={i === index ? 'animate-rise' : ''}
          onKeyDown={(event) => {
            // Entrée dans un champ de saisie vaut Continuer ; ni sur un bouton, ni sur un choix.
            const target = event.target;
            // Entrée qui valide une composition IME (japonais, chinois…) ne fait pas avancer.
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            if (!(target instanceof HTMLInputElement)) return;
            if (!['text', 'email', 'search', 'number', 'tel'].includes(target.type)) return;
            event.preventDefault();
            advance();
          }}
        >
          {item.content}
        </div>
      ))}
      {/* Continuer, ou la confirmation, prend toute la largeur laissée par Retour (#869). */}
      <div className="flex gap-2">
        {index > 0 && (
          // Pas de retour pendant la commande en vol : son issue se dit à cette étape.
          <Button
            variant="secondary"
            icon={<ArrowLeft aria-hidden="true" />}
            disabled={confirming}
            onClick={() => go(index - 1)}
          >
            {labels.back}
          </Button>
        )}
        <Button
          ref={last ? confirmButton : undefined}
          className="min-w-0 flex-1"
          icon={last ? <Check aria-hidden="true" /> : undefined}
          disabled={step?.valid === false}
          loading={last && confirming}
          aria-describedby={last ? confirmDescribedBy : undefined}
          onClick={advance}
        >
          {last ? (
            labels.confirm
          ) : (
            <>
              {labels.next}
              <ArrowRight aria-hidden="true" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
