import { cn } from '~/utils';

interface ChartEmptyProps {
  ariaLabel: string;
  label?: string;
  className?: string;
}

/** Fallback rendered by every chart when there is nothing to plot. */
export default function ChartEmpty({ ariaLabel, label, className }: ChartEmptyProps) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn(
        'flex h-48 w-full items-center justify-center rounded-lg border border-border-light text-sm text-text-secondary',
        className,
      )}
    >
      {label ? <span>{label}</span> : null}
    </div>
  );
}
