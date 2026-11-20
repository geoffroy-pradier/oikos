/** Système de design OIKOS (ADR 0010, ADR 0011). La feuille de thème s'importe par `@oikos/ui/theme.css`. */
export { cn } from './cn';
export { Badge, type BadgeProps } from './components/Badge';
export { Button, type ButtonProps } from './components/Button';
export { IconButton, type IconButtonProps } from './components/Button';
export { Card, type CardProps } from './components/Card';
export { EmptyState, type EmptyStateProps } from './components/EmptyState';
export { Field, type FieldProps } from './components/Field';
export { TextField, type TextFieldProps } from './components/Field';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentOption,
} from './components/SegmentedControl';
export { NumberField, type NumberFieldProps } from './components/NumberField';
export { Select, type SelectProps } from './components/Select';
export { Skeleton } from './components/Skeleton';
export { Stat, type StatProps } from './components/Stat';
export { Switch, type SwitchProps } from './components/Switch';
export { Tabs, type TabItem, type TabsProps } from './components/Tabs';
export { PillTabs, type PillTabsProps } from './components/Tabs';
export { AA_TEXT, AA_UI, COLOR_TOKENS, CONTRAST_PAIRS, contrastRatio } from './contrast';
export * from './icons';
export { numberProblem, readTypedNumber, typedIntegerProblem, type NumberProblem } from './numbers';
