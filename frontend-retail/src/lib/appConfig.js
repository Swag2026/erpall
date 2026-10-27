// Which business this build of the UI is, and where the other one lives.
// Retail and Bullion are two separate sites/databases behind ONE backend and ONE login (same username + password).
export const APP_ID = 'retail';

// Single-domain build (both apps under one site, e.g. /retail and /bullion) vs. stand-alone site at '/'.
export const PATH_MODE = (import.meta.env.BASE_URL || '/') !== '/';

export const APPS_META = {
  retail:  { id: 'retail',  name: 'Retail',  nameAr: 'التجزئة',      url: import.meta.env.VITE_RETAIL_URL  || (PATH_MODE ? '/retail/'  : 'https://goldpos.swag.sa') },
  bullion: { id: 'bullion', name: 'Bullion', nameAr: 'سواج بوليون', url: import.meta.env.VITE_BULLION_URL || (PATH_MODE ? '/bullion/' : 'https://swag-gold-react.vercel.app') },
};
export const OTHER_APP_ID = 'bullion';
