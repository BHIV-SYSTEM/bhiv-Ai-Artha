import clsx from 'clsx';
import { Loader2, CheckCircle2 } from 'lucide-react';

/**
 * Water-fill submit button. The fill rises as `progress` (0-100) increases
 * so users can see how complete the form is. The button always stays
 * clickable — missing required fields are flagged by form validation on submit.
 */
const ProgressSubmitButton = ({
  children,
  progress = 0,
  loading = false,
  disabled = false,
  size = 'md',
  className,
  icon: Icon,
  hint = 'Missing required fields are highlighted when you submit',
  showHint = true,
  ...props
}) => {
  const pct = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
  const complete = pct >= 100;
  const isDisabled = disabled || loading;

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <div className="inline-flex flex-col items-stretch gap-1">
      <button
        type="submit"
        disabled={isDisabled}
        className={clsx(
          'relative overflow-hidden inline-flex items-center justify-center gap-2 rounded-lg font-medium',
          'transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
          'disabled:cursor-not-allowed',
          sizes[size],
          complete
            ? 'bg-primary text-primary-foreground shadow-lg'
            : 'bg-muted text-foreground border border-border',
          className
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 z-0 pointer-events-none transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        >
          <span
            className={clsx(
              'absolute inset-0 transition-colors duration-500',
              complete ? 'bg-primary' : 'bg-primary/35'
            )}
          />
          <span className="water-wave" />
        </span>

        <span className="relative z-10 inline-flex items-center gap-2 whitespace-nowrap">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : Icon ? (
            <Icon className="w-4 h-4" />
          ) : complete ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : null}
          {children}
          <span
            className={clsx(
              'text-xs font-semibold tabular-nums rounded px-1.5 py-0.5',
              complete
                ? 'bg-primary-foreground/20 text-primary-foreground'
                : 'bg-foreground/10 text-foreground/70'
            )}
          >
            {pct}%
          </span>
        </span>
      </button>

      {showHint && !complete && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
};

export default ProgressSubmitButton;
