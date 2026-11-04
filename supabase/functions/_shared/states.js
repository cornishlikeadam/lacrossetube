// The states a team can apply from (college players, this version). Stored with the team only;
// there are no state boards yet. The database checks the same list in public.us_states().
export const US_STATES = ['New York', 'California', 'Pennsylvania', 'Maryland', 'New Jersey', 'Massachusetts', 'Florida', 'Texas',
  'Virginia', 'Connecticut', 'Ohio', 'Michigan', 'North Carolina', 'Colorado', 'Illinois', 'Georgia', 'Minnesota',
  'Washington', 'Arizona', 'Utah', 'Oregon', 'Rhode Island', 'New Hampshire', 'Delaware', 'Wisconsin'];
// An optional school website: a full https:// link, as the database accepts it.
export const WEBSITE = /^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?(\/[^\s<>"']*)?$/;
export const validWebsite = s => String(s).length <= 200 && WEBSITE.test(String(s));
