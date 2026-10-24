// FHIR EpisodeOfCare.status codes, in lifecycle order.
// `entered-in-error` is never chosen in the form; deleting a patient sets it.
export const STATUSES = [
  { code: 'planned', label: 'Planned', description: 'Expected to start care. Intake and onboarding happen here.' },
  { code: 'waitlist', label: 'Waitlist', description: 'Waiting for a spot before care can begin.' },
  { code: 'active', label: 'Active', description: 'Currently receiving care.' },
  { code: 'onhold', label: 'On hold', description: 'Care is temporarily paused.' },
  { code: 'finished', label: 'Finished', description: 'Care is complete; no further care is expected.' },
  { code: 'cancelled', label: 'Cancelled', description: 'Ended before or outside the normal path.' },
];

export const ENTERED_IN_ERROR = 'entered-in-error';

// 50 states, DC, territories, and military ("Armed Forces") codes.
export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'],
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'],
  ['AA', 'Armed Forces Americas'], ['AE', 'Armed Forces Europe'], ['AP', 'Armed Forces Pacific'],
].map(([code, name]) => ({ code, name }));
