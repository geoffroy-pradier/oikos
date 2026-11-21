import { Sheet, StatusRegion, Stepper, TextField } from '@oikos/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cityCommand } from '../api';
import { useHouse } from '../house';
import { filterCitizens } from '../ostracism';
import { useStepperLabels } from '../stepper-labels';

const CHOICE =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border-subtle px-3 py-2 transition-colors duration-(--motion-fast) hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-primary-subtle has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary';
/** Citoyens montrés à la fois : la liste reste courte à lire et à parcourir, la recherche trouve les autres. */
const SHOWN = 50;

/**
 * Feuille du vote d'ostracisme (6.4), en deux étapes : un citoyen de la cité choisi dans une liste filtrable (sa propre
 * maison comprise), puis la confirmation. Le vote est secret : rien ne rend le nom inscrit une fois le bulletin
 * déposé. La même intention restée sans réponse repart sous la même clé.
 */
export function OstraconSheet(props: {
  ostracismId: string;
  citizens: readonly { id: string; name: string }[];
  open: boolean;
  onClose: () => void;
  onCast: (message: string) => Promise<unknown>;
  onRefused: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const house = useHouse();
  const steps = useStepperLabels();
  const [query, setQuery] = useState('');
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [round, setRound] = useState(0);
  const keys = useRef(new Map<string, string>());
  const running = useRef(false);
  const goneNote = useRef<HTMLDivElement>(null);
  const number = new Intl.NumberFormat(i18n.language);
  const matches = filterCitizens(props.citizens, query);
  const shown = matches.slice(0, SHOWN);
  const chosen = props.citizens.find((citizen) => citizen.id === chosenId) ?? null;

  // Le citoyen choisi a disparu de la liste relue (après un refus) : retour au choix, pas un récapitulatif vide.
  const vanished = chosenId !== null && chosen === null;
  useEffect(() => {
    if (!vanished) return;
    setChosenId(null);
    setRefusal(null);
    setGone(true);
    setRound((value) => value + 1);
  }, [vanished]);

  // Le remontage de l'étape détruit le bouton qui avait le foyer : il passe à l'annonce, déjà présente.
  useEffect(() => {
    if (round > 0) goneNote.current?.focus();
  }, [round]);

  async function cast() {
    if (!chosen || running.current) return;
    running.current = true;
    setBusy(true);
    setRefusal(null);
    const input = { ostracismId: props.ostracismId, houseId: chosen.id };
    const intent = JSON.stringify(input);
    const key = keys.current.get(intent) ?? crypto.randomUUID();
    keys.current.set(intent, key);
    try {
      const result = await cityCommand('city.castOstracon', input, house.accessToken, key);
      if (result.ok || result.error.code !== 'INTERNAL') keys.current.delete(intent);
      if (result.ok) {
        setChosenId(null);
        setQuery('');
        props.onClose();
        await props.onCast(t('cityOstracism.done'));
      } else {
        setRefusal(t([`errors.${result.error.code}`, 'errors.INTERNAL']));
        await props.onRefused();
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const chooseStep = (
    <div className="flex flex-col gap-3">
      <TextField
        label={t('cityOstracism.sheet.search')}
        hint={t('cityOstracism.sheet.searchHint')}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <fieldset className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        <legend className="sr-only">{t('cityOstracism.sheet.legend')}</legend>
        {shown.map((citizen) => (
          <label key={citizen.id} className={CHOICE}>
            <input
              className="size-5 shrink-0 accent-primary"
              type="radio"
              name="ostracon-target"
              checked={citizen.id === chosenId}
              onChange={() => {
                setChosenId(citizen.id);
                setGone(false);
              }}
            />
            <span className="min-w-0 font-medium">
              {citizen.id === house.id
                ? t('cityOstracism.sheet.yourHouse', { house: citizen.name })
                : citizen.name}
            </span>
          </label>
        ))}
      </fieldset>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {matches.length === 0
          ? t('cityOstracism.sheet.none')
          : matches.length > SHOWN
            ? t('cityOstracism.sheet.more', {
                shown: number.format(SHOWN),
                total: number.format(matches.length),
              })
            : t('cityOstracism.sheet.count', { count: matches.length })}
      </p>
    </div>
  );
  const recapStep = chosen && (
    <div className="flex flex-col gap-3">
      <p className="font-medium">{t('cityOstracism.sheet.recap', { house: chosen.name })}</p>
      <p className="text-sm text-muted-foreground">{t('cityOstracism.sheet.recapNote')}</p>
      <StatusRegion role="alert" tone="danger">
        {refusal}
      </StatusRegion>
    </div>
  );

  return (
    <Sheet
      open={props.open}
      onClose={() => !busy && props.onClose()}
      title={t('cityOstracism.sheet.title')}
      description={t('cityOstracism.sheet.secret')}
      closeLabel={t('shell.close')}
      closeDisabled={busy}
    >
      <StatusRegion ref={goneNote} tone="info">
        {gone ? t('cityOstracism.sheet.gone') : null}
      </StatusRegion>
      <Stepper
        key={round}
        confirming={busy}
        onConfirm={() => void cast()}
        labels={{ ...steps, confirm: t('cityOstracism.sheet.confirm') }}
        steps={[
          {
            id: 'choose',
            title: t('cityOstracism.sheet.stepChoose'),
            content: chooseStep,
            valid: chosen !== null,
          },
          { id: 'recap', title: t('cityOstracism.sheet.stepRecap'), content: recapStep },
        ]}
      />
    </Sheet>
  );
}
