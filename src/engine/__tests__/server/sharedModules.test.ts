import { describe, it, expect } from 'vitest';
import * as clientPen from '../../penalties';
import * as clientPerfect from '../../perfectAnnouncement';
import * as clientName from '../../playerNameMatch';
import * as clientRules from '../../marketRules';
import { DEFAULT_LEAGUE_SETTINGS } from '../../../types';
import * as srvPen from '../../../../supabase/functions/_shared/rosterPenalties';
import * as srvPerfect from '../../../../supabase/functions/_shared/perfectAnnouncement';
import * as srvName from '../../../../supabase/functions/_shared/playerNameMatch';
import * as srvRules from '../../../../supabase/functions/_shared/marketRules';

// Same idea as playoffLogic.test.ts: these edge-function helpers are hand copies of client modules,
// so they are run side by side with the client versions on the same inputs.

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('roster penalties: server matches the client', () => {
  const MARKETS = ['h2h', 'spreads', 'totals', 'player_reception_yds', 'player_rush_yds', 'player_pass_yds', 'player_anytime_td', 'player_receptions'];
  const SIDES = ['KC', 'BUF', 'Over', 'Under', 'Yes'];
  const PLAYERS = ['KC-travis-kelce', 'KC-rashee-rice', 'BUF-josh-allen', 'BUF-dalton-kincaid', 'KC-patrick-mahomes', undefined];
  const GAMES = ['g1', 'g2', 'g3'];

  function randomPicks(rand: () => number) {
    const n = 1 + Math.floor(rand() * 7);
    return Array.from({ length: n }, (_, i) => ({
      slotId: `s${i}`,
      gameId: GAMES[Math.floor(rand() * GAMES.length)],
      marketKey: MARKETS[Math.floor(rand() * MARKETS.length)],
      side: SIDES[Math.floor(rand() * SIDES.length)],
      playerId: PLAYERS[Math.floor(rand() * PLAYERS.length)],
      stake: 5 + Math.floor(rand() * 20),
      // Some identical timestamps, so the slot id tiebreak is exercised too.
      placedAt: `2026-10-0${1 + Math.floor(rand() * 3)}T12:00:00Z`,
    }));
  }

  const variants = [
    { correlationBlockEnabled: false, minGamesPerRoster: null },
    { correlationBlockEnabled: true, minGamesPerRoster: null },
    { correlationBlockEnabled: true, minGamesPerRoster: 3 },
    { correlationBlockEnabled: false, minGamesPerRoster: 1 },
  ];

  it('reaches the same verdict on hundreds of random rosters', () => {
    const rand = lcg(2026);
    const seen = { invalid: 0, tooFew: 0, fee: 0, clean: 0 };
    for (let trial = 0; trial < 400; trial++) {
      const picks = randomPicks(rand);
      for (const v of variants) {
        const settings = {
          ...DEFAULT_LEAGUE_SETTINGS,
          invalidRosterPenaltyEnabled: true,
          invalidRosterFee: 10,
          ...v,
        };
        const s = srvPen.checkRosterRules(picks as never, settings as never);
        const c = clientPen.checkRosterRules(picks as never, settings as never);
        expect([...s.invalidSlotIds].sort()).toEqual([...c.invalidSlotIds].sort());
        expect(s.tooFewGames).toBe(c.tooFewGames);
        expect(s.feeApplies).toBe(c.feeApplies);
        if (s.invalidSlotIds.length > 0) seen.invalid++;
        if (s.tooFewGames) seen.tooFew++;
        if (s.feeApplies) seen.fee++;
        else seen.clean++;
      }
    }
    // The comparison only means something if the random rosters actually hit each branch.
    expect(seen.invalid).toBeGreaterThan(50);
    expect(seen.tooFew).toBeGreaterThan(50);
    expect(seen.clean).toBeGreaterThan(50);
  });

  it('agrees on the empty-slot floor, including the cap at credits split across slots', () => {
    const slots = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, ML: 1 };
    for (const emptySlotFloor of [null, 0, -5, 3, 12.5, 500]) {
      for (const weeklyCredits of [0, 60, 100]) {
        const input = { weeklyCredits, lineupSlots: slots, emptySlotFloor };
        expect(srvPen.effectiveEmptyFloor(input)).toBe(clientPen.effectiveEmptyFloor(input as never));
      }
    }
    expect(srvPen.effectiveEmptyFloor({ weeklyCredits: 100, lineupSlots: {}, emptySlotFloor: 5 })).toBeNull();
    expect(srvPen.effectiveEmptyFloor({ weeklyCredits: 80, lineupSlots: { QB: 2, RB: 2 }, emptySlotFloor: 50 })).toBe(20);
  });

  it('reads a pick\'s NFL team off the player id the same way', () => {
    for (const id of ['KC-rashee-rice', 'buf-josh-allen', 'LAR-puka-nacua', 'X-nobody', 'TOOLONG-x', '', 'abc']) {
      expect(srvPen.playerTeamFromId(id)).toBe(clientPen.playerTeamFromId(id));
    }
  });

  it('voids the later-placed duplicate player and charges the fee, with nothing else going wrong', () => {
    const picks = [
      { slotId: 'a', gameId: 'g1', marketKey: 'player_rush_yds', side: 'Over', playerId: 'KC-isiah-pacheco', stake: 10, placedAt: '2026-10-01T10:00:00Z' },
      { slotId: 'b', gameId: 'g2', marketKey: 'player_receptions', side: 'Over', playerId: 'KC-isiah-pacheco', stake: 10, placedAt: '2026-10-01T11:00:00Z' },
    ];
    const r = srvPen.checkRosterRules(picks, { ...DEFAULT_LEAGUE_SETTINGS, correlationBlockEnabled: false } as never);
    expect(r.invalidSlotIds).toEqual(['b']);
    expect(r.feeApplies).toBe(true);
    expect(r.tooFewGames).toBe(false);
  });

  it('flags a roster spread over too few games, and never an empty roster', () => {
    const one = [{ slotId: 'a', gameId: 'g1', marketKey: 'h2h', side: 'KC', stake: 10, placedAt: 't' }];
    expect(srvPen.checkRosterRules(one, { ...DEFAULT_LEAGUE_SETTINGS, correlationBlockEnabled: false, minGamesPerRoster: null } as never).tooFewGames).toBe(true);
    expect(srvPen.checkRosterRules([], { ...DEFAULT_LEAGUE_SETTINGS, minGamesPerRoster: 5 } as never)).toEqual({ invalidSlotIds: [], tooFewGames: false, feeApplies: false });
  });
});

describe('perfect-week announcement: server matches the client', () => {
  const posts = [
    { weekLabel: 'Week 5', teamName: 'Blunter\'s Boys', record: '6-0-1', pl: '+$42.30', teamId: 'team-1' },
    { weekLabel: 'Wild Card', teamName: '**Bold|Name::pw::**', record: '4-0-0', pl: '+$9.00', teamId: 'team-2' },
  ];

  it('writes byte-identical posts', () => {
    for (const p of posts) expect(srvPerfect.encodePerfectWeek(p)).toBe(clientPerfect.encodePerfectWeek(p));
  });

  it('is read back by the app, even when the team name tried to inject markup or the tag', () => {
    for (const p of posts) {
      const parsed = clientPerfect.parsePerfectWeek(srvPerfect.encodePerfectWeek(p));
      expect(parsed).not.toBeNull();
      expect(parsed?.teamId).toBe(p.teamId);
      expect(parsed?.record).toBe(p.record);
      expect(parsed?.pl).toBe(p.pl);
      expect(parsed?.teamName).not.toMatch(/[*|]|::pw::/);
    }
  });

  it('formats signed money with a sign, two decimals and no negative zero', () => {
    expect(srvPerfect.signedMoney(42.3)).toBe('+$42.30');
    expect(srvPerfect.signedMoney(-3.1)).toBe('-$3.10');
    expect(srvPerfect.signedMoney(0)).toBe('+$0.00');
    expect(srvPerfect.signedMoney(0.004)).toBe('+$0.00');
  });
});

describe('player name matching: server matches the client', () => {
  const names = ['Travis Kelce', 'C.J. Stroud', 'Amon-Ra St. Brown', 'Odell Beckham Jr.', 'Marvin Harrison Jr', 'Ja\'Marr Chase', 'Ja’Marr Chase', 'D’Andre Swift', 'José Alvarez', 'Pat Surtain II', 'Kenneth Walker III', '  Josh   Allen  ', 'DK Metcalf', 'A. Iosivas', 'T.J. Hockenson', 'Jalen Hurts'];

  it('normalizes every name identically, accents and apostrophe variants included', () => {
    for (const n of names) expect(srvName.normalizePlayerName(n)).toBe(clientName.normalizePlayerName(n));
    expect(srvName.normalizePlayerName('José Alvarez')).toBe('jose alvarez');
    expect(srvName.normalizePlayerName('Odell Beckham Jr.')).toBe('odell beckham');
    expect(srvName.normalizePlayerName('C.J. Stroud')).toBe('cj stroud');
  });

  it('matches against a candidate list the same way, in all four outcomes', () => {
    const candidates = [
      { playerName: 'Travis Kelce', team: 'KC' },
      { playerName: 'Tyreek Hill', team: 'MIA' },
      { playerName: 'Jonnu Smith', team: 'MIA' },
      { playerName: 'Davante Smith', team: 'MIA' },
      { playerName: 'Amon-Ra St. Brown', team: 'DET' },
      { playerName: 'Andrei Iosivas', team: 'CIN' },
    ];
    const cases: Array<[string, string | null]> = [
      ['Travis Kelce', 'KC'], // exact
      ['travis kelce', null], // exact without a team
      ['Amon Ra St Brown', 'DET'], // exact after normalization
      ['A. Iosivas', 'CIN'], // fallback on last name plus team
      ['A. Iosivas', null], // no team, no fallback
      ['Alex Smith', 'MIA'], // ambiguous: two Smiths on MIA
      ['Nobody Here', 'KC'], // not found
    ];
    for (const [name, team] of cases) {
      expect(srvName.matchPlayerName(name, team, candidates)).toEqual(clientName.matchPlayerName(name, team, candidates));
    }
    expect(srvName.matchPlayerName('A. Iosivas', 'CIN', candidates).status).toBe('fallback');
    expect(srvName.matchPlayerName('Alex Smith', 'MIA', candidates).status).toBe('ambiguous');
    expect(srvName.matchPlayerName('A. Iosivas', null, candidates).status).toBe('not_found');
  });
});

describe('market rules for bot lineups', () => {
  const settings = (rules: unknown[], enabled = true) => ({ marketRulesEnabled: enabled, marketRules: rules });

  it('ignores every rule while the toggle is off, or when settings are junk', () => {
    const rules = [{ id: 'a', market: 'player_receptions', side: null, maxStake: null }];
    expect(srvRules.blockedMarketRules(settings(rules, false))).toEqual([]);
    expect(srvRules.slotCapRules(settings(rules, false))).toEqual([]);
    for (const junk of [null, undefined, 5, 'x', {}, { marketRulesEnabled: true }, { marketRulesEnabled: true, marketRules: 'nope' }]) {
      expect(srvRules.blockedMarketRules(junk)).toEqual([]);
      expect(srvRules.slotCapRules(junk)).toEqual([]);
    }
  });

  it('treats a rule with no stake cap and no slot cap as a block, and anything else as a limit', () => {
    const s = settings([
      { id: '1', market: 'player_receptions', side: null, maxStake: null, maxSlots: null },
      { id: '2', market: 'player_rush_yds', side: 'Over', maxStake: 5 },
      { id: '3', market: 'player_pass_yds', side: null, maxStake: null, maxSlots: 1 },
      { id: '4', market: 'player_reception_yds', side: 'Under', maxStake: 10, maxSlots: 2 },
    ]);
    expect(srvRules.blockedMarketRules(s).map((r) => r.market)).toEqual(['player_receptions']);
    expect(srvRules.slotCapRules(s).map((r) => [r.market, r.maxSlots])).toEqual([
      ['player_pass_yds', 1],
      ['player_reception_yds', 2],
    ]);
  });

  it('matches the client on which rules count, and on block versus limit', () => {
    const rules = [
      { id: '1', market: 'h2h', side: null, maxStake: null },
      { id: '2', market: 'spreads', side: 'Home', maxStake: 5 },
      { id: '3', market: 'totals', side: null, maxStake: null, maxSlots: 1 },
      { id: '4', market: 'player_receptions', side: null, maxStake: null },
      { id: '5', market: 'player_rush_yds', side: 'Over', maxStake: 5, maxSlots: null },
      { id: '6', market: 'player_pass_yds', side: null, maxStake: null, maxSlots: 1 },
    ];
    const s = settings(rules);
    const clientActive = clientRules.activeMarketRules(s as never);
    const clientBlocked = clientActive.filter((r) => clientRules.isBlockRule(r)).map((r) => r.market);
    expect(srvRules.blockedMarketRules(s).map((r) => r.market)).toEqual(clientBlocked);
    const clientCaps = clientActive.filter((r) => r.maxSlots != null).map((r) => r.market);
    expect(srvRules.slotCapRules(s).map((r) => r.market)).toEqual(clientCaps);
    // Moneyline, spread and total can never be ruled on, so none of them survive on either side.
    for (const m of ['h2h', 'spreads', 'totals']) {
      expect(srvRules.blockedMarketRules(s).map((r) => r.market)).not.toContain(m);
      expect(srvRules.slotCapRules(s).map((r) => r.market)).not.toContain(m);
    }
  });

  it('blocks a side case-insensitively, or every side when the rule names none', () => {
    const both = [{ market: 'player_receptions', side: null, maxStake: null }];
    expect(srvRules.isMarketBlocked(both, 'player_receptions', 'Over')).toBe(true);
    expect(srvRules.isMarketBlocked(both, 'player_rush_yds', 'Over')).toBe(false);
    const overOnly = [{ market: 'player_receptions', side: 'Over', maxStake: null }];
    expect(srvRules.isMarketBlocked(overOnly, 'player_receptions', 'over')).toBe(true);
    expect(srvRules.isMarketBlocked(overOnly, 'player_receptions', 'Under')).toBe(false);
  });

  it('stops a bot at the slot cap, counting only the same market and side', () => {
    const caps = [{ market: 'player_reception_yds', side: null, maxStake: null, maxSlots: 2 }];
    const none: Array<{ marketKey: string; side: string }> = [];
    const one = [{ marketKey: 'player_reception_yds', side: 'Over' }];
    const two = [...one, { marketKey: 'player_reception_yds', side: 'Under' }];
    expect(srvRules.breaksSlotCap(caps, 'player_reception_yds', 'Over', none)).toBe(false);
    expect(srvRules.breaksSlotCap(caps, 'player_reception_yds', 'Over', one)).toBe(false);
    expect(srvRules.breaksSlotCap(caps, 'player_reception_yds', 'Over', two)).toBe(true);
    expect(srvRules.breaksSlotCap(caps, 'player_rush_yds', 'Over', two)).toBe(false);
    const sided = [{ market: 'player_reception_yds', side: 'Over', maxStake: null, maxSlots: 1 }];
    expect(srvRules.breaksSlotCap(sided, 'player_reception_yds', 'Over', [{ marketKey: 'player_reception_yds', side: 'under' }])).toBe(false);
    expect(srvRules.breaksSlotCap(sided, 'player_reception_yds', 'over', [{ marketKey: 'player_reception_yds', side: 'Over' }])).toBe(true);
    expect(srvRules.breaksSlotCap(sided, 'player_reception_yds', 'Under', two)).toBe(false);
  });

  it('agrees with the client\'s slot-cap check for the same rule and picks', () => {
    const rule = { id: 'r', market: 'player_reception_yds', side: 'Over', maxStake: null, maxSlots: 2 };
    const srvRule = [{ market: rule.market, side: rule.side, maxStake: null, maxSlots: 2 }];
    for (const side of ['Over', 'over', 'Under']) {
      for (let used = 0; used <= 3; used++) {
        const picks = Array.from({ length: used }, () => ({ marketKey: 'player_reception_yds', side: 'Over' }));
        const clientBlocks = clientRules.marketSlotCapReason([rule as never], 'player_reception_yds', side, picks) != null;
        expect(srvRules.breaksSlotCap(srvRule, 'player_reception_yds', side, picks)).toBe(clientBlocks);
      }
    }
  });
});
