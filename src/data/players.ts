import type { Player, Position } from '../types';

// Curated depth chart per team (starter-level, realistic 2026 NFL names) covering
// every position a lineup slot needs: 1 QB, 2 RB, 3 WR, 1 TE, 1 K per team (8 skill
// players x 32 teams = 256), giving plenty of distinct choices across a week's slate
// without needing a synthetic name generator that would read as fake.
interface DepthChart {
  QB: string[];
  RB: string[];
  WR: string[];
  TE: string[];
  K: string[];
}

const DEPTH_CHARTS: Record<string, DepthChart> = {
  BUF: { QB: ['Josh Allen'], RB: ['James Cook', 'Ray Davis'], WR: ['Khalil Shakir', 'Keon Coleman', 'Curtis Samuel'], TE: ['Dalton Kincaid'], K: ['Tyler Bass'] },
  MIA: { QB: ['Tua Tagovailoa'], RB: ["De'Von Achane", 'Jaylen Wright'], WR: ['Tyreek Hill', 'Jaylen Waddle', 'Odell Beckham Jr.'], TE: ['Jonnu Smith'], K: ['Jason Sanders'] },
  NE: { QB: ['Drake Maye'], RB: ['Rhamondre Stevenson', 'TreVeyon Henderson'], WR: ['Stefon Diggs', 'DeMario Douglas', 'Kayshon Boutte'], TE: ['Hunter Henry'], K: ['Andy Borregales'] },
  NYJ: { QB: ['Justin Fields'], RB: ['Breece Hall', 'Braelon Allen'], WR: ['Garrett Wilson', 'Josh Reynolds', 'Allen Lazard'], TE: ['Jeremy Ruckert'], K: ['Nick Folk'] },
  BAL: { QB: ['Lamar Jackson'], RB: ['Derrick Henry', 'Justice Hill'], WR: ['Zay Flowers', 'Rashod Bateman', 'DeAndre Hopkins'], TE: ['Mark Andrews'], K: ['Tyler Loop'] },
  CIN: { QB: ['Joe Burrow'], RB: ['Chase Brown', 'Tahj Brooks'], WR: ["Ja'Marr Chase", 'Tee Higgins', 'Andrei Iosivas'], TE: ['Mike Gesicki'], K: ['Evan McPherson'] },
  CLE: { QB: ['Dillon Gabriel'], RB: ['Quinshon Judkins', 'Jerome Ford'], WR: ['Jerry Jeudy', 'Cedric Tillman', 'Jamari Thrash'], TE: ['David Njoku'], K: ['Andre Szmyt'] },
  PIT: { QB: ['Aaron Rodgers'], RB: ['Jaylen Warren', 'Kaleb Johnson'], WR: ['DK Metcalf', 'Calvin Austin III', 'Roman Wilson'], TE: ['Pat Freiermuth'], K: ['Chris Boswell'] },
  HOU: { QB: ['C.J. Stroud'], RB: ['Joe Mixon', 'Woody Marks'], WR: ['Nico Collins', 'Christian Kirk', 'Jayden Higgins'], TE: ['Dalton Schultz'], K: ["Ka'imi Fairbairn"] },
  IND: { QB: ['Daniel Jones'], RB: ['Jonathan Taylor', 'DJ Giddens'], WR: ['Michael Pittman Jr.', 'Josh Downs', 'Alec Pierce'], TE: ['Tyler Warren'], K: ['Spencer Shrader'] },
  JAX: { QB: ['Trevor Lawrence'], RB: ['Travis Etienne Jr.', 'Tank Bigsby'], WR: ['Brian Thomas Jr.', 'Dyami Brown', 'Parker Washington'], TE: ['Brenton Strange'], K: ['Cam Little'] },
  TEN: { QB: ['Cam Ward'], RB: ['Tony Pollard', 'Tyjae Spears'], WR: ['Calvin Ridley', 'Elic Ayomanor', 'Van Jefferson'], TE: ['Chig Okonkwo'], K: ['Joey Slye'] },
  DEN: { QB: ['Bo Nix'], RB: ['J.K. Dobbins', 'RJ Harvey'], WR: ['Courtland Sutton', 'Marvin Mims Jr.', 'Troy Franklin'], TE: ['Evan Engram'], K: ['Wil Lutz'] },
  KC: { QB: ['Patrick Mahomes'], RB: ['Isiah Pacheco', 'Kareem Hunt'], WR: ['Xavier Worthy', 'DeAndre Hopkins', 'Rashee Rice'], TE: ['Travis Kelce'], K: ['Harrison Butker'] },
  LV: { QB: ['Geno Smith'], RB: ['Ashton Jeanty', 'Raheem Mostert'], WR: ['Jakobi Meyers', 'Tre Tucker', "Dont'e Thornton Jr."], TE: ['Brock Bowers'], K: ['Daniel Carlson'] },
  LAC: { QB: ['Justin Herbert'], RB: ['Omarion Hampton', 'Najee Harris'], WR: ['Quentin Johnston', 'Ladd McConkey', 'Keenan Allen'], TE: ['Will Dissly'], K: ['Cameron Dicker'] },
  DAL: { QB: ['Dak Prescott'], RB: ['Javonte Williams', 'Miles Sanders'], WR: ['CeeDee Lamb', 'George Pickens', 'Jalen Tolbert'], TE: ['Jake Ferguson'], K: ['Brandon Aubrey'] },
  NYG: { QB: ['Jaxson Dart'], RB: ['Tyrone Tracy Jr.', 'Cam Skattebo'], WR: ['Malik Nabers', "Wan'Dale Robinson", 'Darius Slayton'], TE: ['Theo Johnson'], K: ['Jude McAtamney'] },
  PHI: { QB: ['Jalen Hurts'], RB: ['Saquon Barkley', 'Will Shipley'], WR: ['A.J. Brown', 'DeVonta Smith', 'Jahan Dotson'], TE: ['Dallas Goedert'], K: ['Jake Elliott'] },
  WAS: { QB: ['Jayden Daniels'], RB: ['Austin Ekeler', 'Jeremy McNichols'], WR: ['Terry McLaurin', 'Deebo Samuel', 'Noah Brown'], TE: ['Zach Ertz'], K: ['Matt Gay'] },
  CHI: { QB: ['Caleb Williams'], RB: ["D'Andre Swift", 'Kyle Monangai'], WR: ['DJ Moore', 'Rome Odunze', 'Luther Burden III'], TE: ['Colston Loveland'], K: ['Cairo Santos'] },
  DET: { QB: ['Jared Goff'], RB: ['Jahmyr Gibbs', 'David Montgomery'], WR: ['Amon-Ra St. Brown', 'Jameson Williams', 'Tim Patrick'], TE: ['Sam LaPorta'], K: ['Jake Bates'] },
  GB: { QB: ['Jordan Love'], RB: ['Josh Jacobs', 'Emanuel Wilson'], WR: ['Jayden Reed', 'Romeo Doubs', 'Matthew Golden'], TE: ['Tucker Kraft'], K: ['Brandon McManus'] },
  MIN: { QB: ['J.J. McCarthy'], RB: ['Aaron Jones', 'Jordan Mason'], WR: ['Justin Jefferson', 'Jordan Addison', 'Jalen Nailor'], TE: ['T.J. Hockenson'], K: ['Will Reichard'] },
  ATL: { QB: ['Michael Penix Jr.'], RB: ['Bijan Robinson', 'Tyler Allgeier'], WR: ['Drake London', 'Darnell Mooney', 'KhaDarel Hodge'], TE: ['Kyle Pitts'], K: ['Younghoe Koo'] },
  CAR: { QB: ['Bryce Young'], RB: ['Chuba Hubbard', 'Rico Dowdle'], WR: ['Xavier Legette', 'Tetairoa McMillan', 'Adam Thielen'], TE: ['Tommy Tremble'], K: ['Ryan Fitzgerald'] },
  NO: { QB: ['Tyler Shough'], RB: ['Alvin Kamara', 'Kendre Miller'], WR: ['Chris Olave', 'Rashid Shaheed', 'Brandin Cooks'], TE: ['Juwan Johnson'], K: ['Blake Grupe'] },
  TB: { QB: ['Baker Mayfield'], RB: ['Bucky Irving', 'Rachaad White'], WR: ['Mike Evans', 'Emeka Egbuka', 'Chris Godwin'], TE: ['Cade Otton'], K: ['Chase McLaughlin'] },
  ARI: { QB: ['Kyler Murray'], RB: ['James Conner', 'Trey Benson'], WR: ['Marvin Harrison Jr.', 'Michael Wilson', 'Zay Jones'], TE: ['Trey McBride'], K: ['Chad Ryland'] },
  LAR: { QB: ['Matthew Stafford'], RB: ['Kyren Williams', 'Blake Corum'], WR: ['Puka Nacua', 'Davante Adams', 'Tutu Atwell'], TE: ['Tyler Higbee'], K: ['Joshua Karty'] },
  SF: { QB: ['Brock Purdy'], RB: ['Christian McCaffrey', 'Jordan Mason'], WR: ['Ricky Pearsall', 'Jauan Jennings', 'Kendrick Bourne'], TE: ['George Kittle'], K: ['Jake Moody'] },
  SEA: { QB: ['Sam Darnold'], RB: ['Kenneth Walker III', 'Zach Charbonnet'], WR: ['Jaxon Smith-Njigba', 'Cooper Kupp', 'Tory Horton'], TE: ['AJ Barner'], K: ['Jason Myers'] },
};

function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function buildRoster(): Player[] {
  const players: Player[] = [];
  for (const [teamId, chart] of Object.entries(DEPTH_CHARTS)) {
    (Object.keys(chart) as Position[]).forEach((position) => {
      chart[position].forEach((name) => {
        players.push({
          id: `${teamId}-${slug(name)}`,
          name,
          position,
          nflTeamId: teamId,
          injury: null,
        });
      });
    });
  }
  return players;
}

export const PLAYERS: Player[] = buildRoster();

export const playersByTeam: Record<string, Player[]> = PLAYERS.reduce<Record<string, Player[]>>(
  (acc, player) => {
    (acc[player.nflTeamId] ??= []).push(player);
    return acc;
  },
  {},
);

export function playerById(id: string): Player {
  const player = PLAYERS.find((p) => p.id === id);
  if (!player) throw new Error(`Unknown player id: ${id}`);
  return player;
}
