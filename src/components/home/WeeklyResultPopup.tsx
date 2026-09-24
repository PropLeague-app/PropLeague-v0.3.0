import type { CSSProperties } from 'react';
import { Trophy, X } from 'lucide-react';
import type { PendingResultReveal } from '../../engine/weeklyResults';
import { TeamLogo } from '../common/TeamLogo';
import { weekLabel } from '../../types';

/** A dozen small falling bars, staggered by a fixed formula (not Math.random, so this
 * never looks different on two renders of the same win) rather than an emoji burst
 * (see chat, Sept 2026: "celebration-style visuals - not emojis"). Purely decorative
 * -- aria-hidden, and pointer-events-none so it never intercepts the dismiss tap
 * underneath it. Win-only; a loss/tie gets no confetti and no gold, per Hunter's
 * explicit call to keep those neutral rather than red (see chat). */
function ConfettiBurst() {
  const pieces = Array.from({ length: 14 }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden="true">
      {pieces.map((i) => {
        const left = (i * 37) % 100; // spread pieces across the width without Math.random
        const delay = (i % 7) * 0.09;
        const duration = 1.6 + (i % 5) * 0.15;
        const rotate = (i * 53) % 360;
        const colors = ['var(--color-gold)', '#ffffff', 'var(--color-profit)'];
        const color = colors[i % colors.length];
        return (
          <span
            key={i}
            className="absolute top-[-12px] w-1.5 h-3 rounded-sm confetti-piece"
            style={
              {
                left: `${left}%`,
                backgroundColor: color,
                animationDelay: `${delay}s`,
                animationDuration: `${duration}s`,
                '--start-rot': `${rotate}deg`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

export function WeeklyResultPopup({
  reveal,
  onViewMatchup,
  onDismiss,
}: {
  reveal: PendingResultReveal;
  onViewMatchup: () => void;
  onDismiss: () => void;
}) {
  const { league, userTeam, opponentTeam, matchup, result } = reveal;
  const userScore = matchup.teamAId === userTeam.id ? matchup.teamAScore : matchup.teamBScore;
  const opponentScore = matchup.teamAId === userTeam.id ? matchup.teamBScore : matchup.teamAScore;
  const won = result === 'won';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={onDismiss}>
      <div
        className={`relative w-full max-w-sm rounded-2xl border p-5 space-y-4 overflow-hidden ${won ? 'border-gold' : 'bg-bg-raised border-border'}`}
        // Inline gradient rather than a Tailwind arbitrary-value + opacity-modifier
        // class (from-[var(--x)]/40) -- that combination isn't something this app
        // relies on elsewhere, so this sticks to the plain CSS the rest of the app
        // already uses for computed backgrounds (see MatchupCard's win-probability
        // bar gradients).
        style={won ? { background: 'linear-gradient(to bottom, var(--color-gold-soft), var(--color-bg-raised) 65%)' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {won && <ConfettiBurst />}
        <button onClick={onDismiss} className="absolute top-3 right-3 text-text-muted p-1" aria-label="Close">
          <X size={18} />
        </button>

        <div className="text-center space-y-1 pt-1">
          <p className="text-[11px] text-text-muted uppercase tracking-wide">
            {league.name} · {weekLabel(matchup.week)} Final
          </p>
          {won ? (
            <div className="flex items-center justify-center gap-1.5">
              <Trophy size={20} className="text-gold" />
              <h2 className="text-xl font-bold text-gold">You won!</h2>
            </div>
          ) : (
            <h2 className="text-xl font-bold text-text">{result === 'tied' ? "It's a tie" : 'You lost'}</h2>
          )}
        </div>

        <div className="flex items-center justify-center gap-4">
          <div className="flex flex-col items-center gap-1.5 min-w-0">
            <TeamLogo team={userTeam} size="lg" />
            <p className="text-xs font-medium truncate max-w-[100px]">{userTeam.teamName}</p>
            <p className={`text-lg font-bold ${won ? 'text-gold' : ''}`}>${(userScore ?? 0).toFixed(2)}</p>
          </div>
          <span className="text-text-muted text-xs font-bold pb-6">VS</span>
          <div className="flex flex-col items-center gap-1.5 min-w-0">
            <TeamLogo team={opponentTeam} size="lg" />
            <p className="text-xs font-medium truncate max-w-[100px]">{opponentTeam.teamName}</p>
            <p className="text-lg font-bold text-text-muted">${(opponentScore ?? 0).toFixed(2)}</p>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onDismiss} className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium">
            Close
          </button>
          <button
            onClick={onViewMatchup}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold ${won ? 'bg-gold text-bg' : 'bg-primary text-white'}`}
          >
            View matchup
          </button>
        </div>
      </div>
    </div>
  );
}
