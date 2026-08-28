import type { NFLTeam } from '../types';

export const NFL_TEAMS: NFLTeam[] = [
  // AFC East
  { id: 'BUF', city: 'Buffalo', name: 'Bills', abbrev: 'BUF', conference: 'AFC', division: 'East', primaryColor: '#00338D', secondaryColor: '#C60C30' },
  { id: 'MIA', city: 'Miami', name: 'Dolphins', abbrev: 'MIA', conference: 'AFC', division: 'East', primaryColor: '#008E97', secondaryColor: '#FC4C02' },
  { id: 'NE', city: 'New England', name: 'Patriots', abbrev: 'NE', conference: 'AFC', division: 'East', primaryColor: '#002244', secondaryColor: '#C60C30' },
  { id: 'NYJ', city: 'New York', name: 'Jets', abbrev: 'NYJ', conference: 'AFC', division: 'East', primaryColor: '#125740', secondaryColor: '#FFFFFF' },
  // AFC North
  { id: 'BAL', city: 'Baltimore', name: 'Ravens', abbrev: 'BAL', conference: 'AFC', division: 'North', primaryColor: '#241773', secondaryColor: '#9E7C0C' },
  { id: 'CIN', city: 'Cincinnati', name: 'Bengals', abbrev: 'CIN', conference: 'AFC', division: 'North', primaryColor: '#FB4F14', secondaryColor: '#000000' },
  { id: 'CLE', city: 'Cleveland', name: 'Browns', abbrev: 'CLE', conference: 'AFC', division: 'North', primaryColor: '#311D00', secondaryColor: '#FF3C00' },
  { id: 'PIT', city: 'Pittsburgh', name: 'Steelers', abbrev: 'PIT', conference: 'AFC', division: 'North', primaryColor: '#FFB612', secondaryColor: '#101820' },
  // AFC South
  { id: 'HOU', city: 'Houston', name: 'Texans', abbrev: 'HOU', conference: 'AFC', division: 'South', primaryColor: '#03202F', secondaryColor: '#A71930' },
  { id: 'IND', city: 'Indianapolis', name: 'Colts', abbrev: 'IND', conference: 'AFC', division: 'South', primaryColor: '#002C5F', secondaryColor: '#A2AAAD' },
  { id: 'JAX', city: 'Jacksonville', name: 'Jaguars', abbrev: 'JAX', conference: 'AFC', division: 'South', primaryColor: '#101820', secondaryColor: '#D7A22A' },
  { id: 'TEN', city: 'Tennessee', name: 'Titans', abbrev: 'TEN', conference: 'AFC', division: 'South', primaryColor: '#0C2340', secondaryColor: '#4B92DB' },
  // AFC West
  { id: 'DEN', city: 'Denver', name: 'Broncos', abbrev: 'DEN', conference: 'AFC', division: 'West', primaryColor: '#FB4F14', secondaryColor: '#002244' },
  { id: 'KC', city: 'Kansas City', name: 'Chiefs', abbrev: 'KC', conference: 'AFC', division: 'West', primaryColor: '#E31837', secondaryColor: '#FFB81C' },
  { id: 'LV', city: 'Las Vegas', name: 'Raiders', abbrev: 'LV', conference: 'AFC', division: 'West', primaryColor: '#000000', secondaryColor: '#A5ACAF' },
  { id: 'LAC', city: 'Los Angeles', name: 'Chargers', abbrev: 'LAC', conference: 'AFC', division: 'West', primaryColor: '#0080C6', secondaryColor: '#FFC20E' },
  // NFC East
  { id: 'DAL', city: 'Dallas', name: 'Cowboys', abbrev: 'DAL', conference: 'NFC', division: 'East', primaryColor: '#003594', secondaryColor: '#869397' },
  { id: 'NYG', city: 'New York', name: 'Giants', abbrev: 'NYG', conference: 'NFC', division: 'East', primaryColor: '#0B2265', secondaryColor: '#A71930' },
  { id: 'PHI', city: 'Philadelphia', name: 'Eagles', abbrev: 'PHI', conference: 'NFC', division: 'East', primaryColor: '#004C54', secondaryColor: '#A5ACAF' },
  { id: 'WAS', city: 'Washington', name: 'Commanders', abbrev: 'WAS', conference: 'NFC', division: 'East', primaryColor: '#5A1414', secondaryColor: '#FFB612' },
  // NFC North
  { id: 'CHI', city: 'Chicago', name: 'Bears', abbrev: 'CHI', conference: 'NFC', division: 'North', primaryColor: '#0B162A', secondaryColor: '#C83803' },
  { id: 'DET', city: 'Detroit', name: 'Lions', abbrev: 'DET', conference: 'NFC', division: 'North', primaryColor: '#0076B6', secondaryColor: '#B0B7BC' },
  { id: 'GB', city: 'Green Bay', name: 'Packers', abbrev: 'GB', conference: 'NFC', division: 'North', primaryColor: '#203731', secondaryColor: '#FFB612' },
  { id: 'MIN', city: 'Minnesota', name: 'Vikings', abbrev: 'MIN', conference: 'NFC', division: 'North', primaryColor: '#4F2683', secondaryColor: '#FFC62F' },
  // NFC South
  { id: 'ATL', city: 'Atlanta', name: 'Falcons', abbrev: 'ATL', conference: 'NFC', division: 'South', primaryColor: '#A71930', secondaryColor: '#000000' },
  { id: 'CAR', city: 'Carolina', name: 'Panthers', abbrev: 'CAR', conference: 'NFC', division: 'South', primaryColor: '#0085CA', secondaryColor: '#101820' },
  { id: 'NO', city: 'New Orleans', name: 'Saints', abbrev: 'NO', conference: 'NFC', division: 'South', primaryColor: '#D3BC8D', secondaryColor: '#101820' },
  { id: 'TB', city: 'Tampa Bay', name: 'Buccaneers', abbrev: 'TB', conference: 'NFC', division: 'South', primaryColor: '#D50A0A', secondaryColor: '#34302B' },
  // NFC West
  { id: 'ARI', city: 'Arizona', name: 'Cardinals', abbrev: 'ARI', conference: 'NFC', division: 'West', primaryColor: '#97233F', secondaryColor: '#000000' },
  { id: 'LAR', city: 'Los Angeles', name: 'Rams', abbrev: 'LAR', conference: 'NFC', division: 'West', primaryColor: '#003594', secondaryColor: '#FFA300' },
  { id: 'SF', city: 'San Francisco', name: '49ers', abbrev: 'SF', conference: 'NFC', division: 'West', primaryColor: '#AA0000', secondaryColor: '#B3995D' },
  { id: 'SEA', city: 'Seattle', name: 'Seahawks', abbrev: 'SEA', conference: 'NFC', division: 'West', primaryColor: '#002244', secondaryColor: '#69BE28' },
];

export const nflTeamById = (id: string): NFLTeam => {
  const team = NFL_TEAMS.find((t) => t.id === id);
  if (!team) throw new Error(`Unknown NFL team id: ${id}`);
  return team;
};
