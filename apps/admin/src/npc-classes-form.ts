import { readNested, type NestedTable, type Row } from './goods-form';
import en from './locales/en.json';

/** Champs d'une classe de PNJ hors de son panier, dans l'ordre du formulaire. Un test les compare au schéma. */
export const NPC_CLASS_FIELDS = [
  { key: 'id', kind: 'text' },
  { key: 'qualitySensitivity', kind: 'decimal' },
  { key: 'incomePerThousand', kind: 'integer' },
  { key: 'publicIncomeBps', kind: 'integer' },
] as const;
/** Champs d'une ligne du panier. */
export const BASKET_FIELDS = [
  { key: 'goodId', kind: 'text' },
  { key: 'need', kind: 'choice' },
  { key: 'quantityPerThousand', kind: 'decimal' },
] as const;
/** Besoins proposés : ceux qui ont un libellé. Un test vérifie qu'ils sont ceux du schéma. */
export const NEED_LEVELS = Object.keys(en.config.npcClassesForm.needs);

/** Formulaire des classes de PNJ : panier imbriqué. */
export const NPC_CLASSES_TABLE: NestedTable = {
  table: 'npcClasses',
  texts: 'npcClassesForm',
  fields: NPC_CLASS_FIELDS,
  lists: [{ key: 'basket', fields: BASKET_FIELDS }],
  choices: { need: { values: NEED_LEVELS, labels: 'config.npcClassesForm.needs' } },
};

/** Classes de PNJ d'une configuration, avec leur panier (`readNested`). */
export const readNpcClasses = (config: unknown): Row[] | null =>
  readNested(config, 'npcClasses', ['basket']);
