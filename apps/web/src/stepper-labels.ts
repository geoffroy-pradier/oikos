import { useTranslation } from 'react-i18next';

/** Libellés traduits du `Stepper` d'une feuille, sans celui de la confirmation, propre à chaque action. */
export function useStepperLabels() {
  const { t } = useTranslation();
  return {
    progress: t('steps.progress'),
    back: t('steps.back'),
    next: t('steps.next'),
    stepOf: (current: number, total: number) => t('steps.stepOf', { current, total }),
  };
}
