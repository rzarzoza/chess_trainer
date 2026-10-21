export interface ProgressBarProps { done: number; total: number; onStop?: () => void }

export function ProgressBar({ done, total, onStop }: ProgressBarProps) {
  const current = Math.min(done + 1, total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress">
      <div className="progress-row">
        <span aria-live="polite">Analysing game {current} of {total}</span>
        {onStop && <button type="button" className="secondary-btn" onClick={onStop}>Stop</button>}
      </div>
      <div className="progress-track" role="progressbar" aria-label="Analysis progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
