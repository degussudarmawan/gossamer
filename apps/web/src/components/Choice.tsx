import { useId } from 'react';
import { note } from './ui';

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  /** What is being chosen. Read out by screen readers; shown above the words only with `showLegend`. */
  legend: string;
  showLegend?: boolean;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  /** While a change is being saved. */
  disabled?: boolean;
};

/**
 * Picking one of a few options, written as words in a row: the chosen one gold
 * and underlined like the room's `action` links, the rest in cream. No pill or
 * box around them (DESIGN.md: no boxes). Underneath they are ordinary radio
 * buttons, so arrow keys move between them and screen readers announce which
 * one is chosen.
 */
export default function Choice<T extends string>({ legend, showLegend = false, value, options, onChange, disabled = false }: Props<T>) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="grid justify-items-center disabled:opacity-50">
      <legend className={showLegend ? `mx-auto mb-2 ${note}` : 'sr-only'}>{legend}</legend>
      <div className="flex flex-wrap justify-center gap-x-6">
        {options.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            {/* the input is hidden, so the word carries the keyboard focus ring */}
            <span className="block rounded py-1 text-base font-medium text-ink-soft decoration-1 underline-offset-4 transition-colors hover:text-ink peer-checked:text-ink peer-checked:underline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ink-soft">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
