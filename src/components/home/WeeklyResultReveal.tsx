import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { getPendingResultReveals } from '../../engine/weeklyResults';
import { WeeklyResultPopup } from './WeeklyResultPopup';

/** Shows one Tuesday-reveal popup at a time for the user's own decided-but-unseen
 * matchups (see engine/weeklyResults.ts), across every league they're in -- not
 * just whichever league happens to be current. Always renders (or renders nothing)
 * rather than being screen-scoped, so this fires regardless of which screen the app
 * opens to. Deliberately takes only reveals[0]: dismissing/viewing marks that one
 * seen via the store, which drops it out of getPendingResultReveals's result on the
 * next render and naturally surfaces the next queued reveal (if any) -- no separate
 * "current index" state needed. */
export function WeeklyResultReveal() {
  const navigate = useNavigate();
  const leagues = useAppStore((s) => s.leagues);
  const seenMatchupResultIds = useAppStore((s) => s.seenMatchupResultIds);
  const markMatchupResultSeen = useAppStore((s) => s.markMatchupResultSeen);
  const setCurrentLeague = useAppStore((s) => s.setCurrentLeague);

  const reveals = getPendingResultReveals(leagues, seenMatchupResultIds);
  const reveal = reveals[0];
  if (!reveal) return null;

  function dismiss() {
    markMatchupResultSeen(reveal.matchup.id);
  }

  return (
    <WeeklyResultPopup
      reveal={reveal}
      onDismiss={dismiss}
      onViewMatchup={() => {
        dismiss();
        // MatchupDetail resolves its matchup from currentLeagueId, not from the
        // matchup id alone -- this reveal can belong to a league other than
        // whichever one the user last had open (see chat, Sept 2026: a user in
        // several leagues can have a reveal queued for any of them), so the
        // league switch has to happen before the navigate, not after.
        setCurrentLeague(reveal.league.id);
        navigate(`/matchup/${reveal.matchup.id}`);
      }}
    />
  );
}
