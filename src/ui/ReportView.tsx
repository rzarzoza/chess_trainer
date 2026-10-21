import type { ExampleRef, Phase, Report, TimeClass } from '../types';
import { WeaknessCard, type BoardInfo } from './WeaknessCard';

export type Filter = TimeClass | 'all';

export interface ReportViewProps {
  report: Report;
  filter: Filter;
  onFilter(f: Filter): void;
  onOpenExamples(key: string): void;
  onOpenExample(ref: ExampleRef): void;
  /** Board data for an example's mini board (null hides the board). */
  boardFor(ref: ExampleRef): BoardInfo | null;
  /** Games left out because the user isn't one of the players. */
  leftOutCount?: number;
}

const CHIPS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'rapid', label: 'Rapid' },
  { value: 'blitz', label: 'Blitz' },
  { value: 'bullet', label: 'Bullet' },
];

const PHASES: { key: Phase; label: string }[] = [
  { key: 'opening', label: 'Opening' },
  { key: 'middlegame', label: 'Middlegame' },
  { key: 'endgame', label: 'Endgame' },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ReportView({ report, filter, onFilter, onOpenExamples, onOpenExample, boardFor, leftOutCount = 0 }: ReportViewProps) {
  const maxCost = Math.max(0, ...report.weaknesses.map((w) => w.cost));
  const phaseMax = Math.max(0, ...PHASES.map((p) => report.byPhase[p.key].count));
  return (
    <section className="report">
      <header className="report-header">
        <h2>{plural(report.gamesAnalysed, 'game')} analysed</h2>
        <div className="chips" role="group" aria-label="Time control">
          {CHIPS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`chip${filter === c.value ? ' on' : ''}`}
              aria-pressed={filter === c.value}
              onClick={() => onFilter(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {report.skippedCount > 0 && (
          <p className="muted">
            Skipped {plural(report.skippedCount, 'game')} we can't analyse (variants, daily, or too short).
          </p>
        )}
        {leftOutCount > 0 && (
          <p className="muted">
            Left out {plural(leftOutCount, 'game')} where we couldn't find you among the players.
          </p>
        )}
      </header>

      <h2 className="section-title">Train these first</h2>
      {report.weaknesses.length === 0 ? (
        <p className="muted">No repeated mistakes found yet.</p>
      ) : (
        report.weaknesses.map((w, i) => (
          <WeaknessCard
            key={w.key}
            rank={i + 1}
            weakness={w}
            maxCost={maxCost}
            board={boardFor(w.typical)}
            onOpenExamples={onOpenExamples}
            onOpenExample={onOpenExample}
          />
        ))
      )}

      <div className="secondary">
        <section className="panel">
          <h2>By phase</h2>
          <ul className="phase-list">
            {PHASES.map((p) => {
              const { count } = report.byPhase[p.key];
              return (
                <li key={p.key}>
                  <span className="phase-name">{p.label}</span>
                  <span className="phase-bar" aria-hidden="true">
                    <span style={{ width: `${phaseMax > 0 ? Math.round((count / phaseMax) * 100) : 0}%` }} />
                  </span>
                  <span className="phase-count">{plural(count, 'mistake')}</span>
                </li>
              );
            })}
          </ul>
        </section>

        {report.timeTrouble && (
          <section className="panel">
            <h2>Time trouble</h2>
            <p>
              {plural(report.timeTrouble.count, 'mistake')} came when you were low on time.
            </p>
          </section>
        )}

        {report.byOpening.length > 0 && (
          <section className="panel">
            <h2>By opening</h2>
            <div className="table-wrap">
              <table className="openings">
                <thead>
                  <tr><th>Opening</th><th>Games</th><th>W / D / L</th><th>Mistakes</th></tr>
                </thead>
                <tbody>
                  {report.byOpening.map((o) => (
                    <tr key={`${o.family}:${o.color}`}>
                      <td>{o.family} <span className="muted">as {o.color === 'w' ? 'White' : 'Black'}</span></td>
                      <td>{o.games}</td>
                      <td>{o.wins} / {o.draws} / {o.losses}</td>
                      <td>{o.moments}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
