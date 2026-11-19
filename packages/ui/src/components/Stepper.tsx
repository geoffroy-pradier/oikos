import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { Button } from './Button';

export interface Step {
  id: string;
  title: string;
  content: ReactNode;
  /** `false` tant que la saisie de l'étape n'est pas valable : Continuer reste inactif. */
  valid?: boolean;
}

export interface StepperProps {
  /** La dernière étape est le récapitulatif chiffré, confirmé par `onConfirm`. */
  steps: readonly Step[];
  onConfirm: () => void;
  /** Commande en cours : Confirmer est marqué occupé. */
  confirming?: boolean;
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
export function Stepper({ steps, onConfirm, confirming = false, labels }: StepperProps) {
  const [index, setIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [index]);
  const go = (next: number) => {
    moved.current = true;
    setIndex(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <ol aria-label={labels.progress} className="flex gap-1.5">
        {steps.map((item, i) => (
          <li
            key={item.id}
            aria-current={i === index ? 'step' : undefined}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors duration-(--motion-base)',
              i <= index ? 'bg-primary' : 'bg-muted',
            )}
          >
            <span className="sr-only">{item.title}</span>
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
        <div key={item.id} hidden={i !== index} className={i === index ? 'animate-rise' : ''}>
          {item.content}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {index > 0 && (
          <Button variant="secondary" onClick={() => go(index - 1)}>
            {labels.back}
          </Button>
        )}
        <Button
          className="ml-auto"
          disabled={step?.valid === false}
          loading={last && confirming}
          onClick={last ? onConfirm : () => go(index + 1)}
        >
          {last ? labels.confirm : labels.next}
        </Button>
      </div>
    </div>
  );
}
