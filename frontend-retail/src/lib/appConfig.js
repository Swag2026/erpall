// Which business this build of the UI is, and where the other one lives.
// Retail and Bullion are two separate sites/databases behind ONE backend and ONE login (same username + password).
export const APP_ID = 'retail';

export const APPS_META = {
  retail:  { id: 'retail',  name: 'Retail',  nameAr: 'التجزئة',      url: import.meta.env.VITE_RETAIL_URL  || 'https://goldpos.swag.sa' },
  bullion: { id: 'bullion', name: 'Bullion', nameAr: 'سواج بوليون', url: import.meta.env.VITE_BULLION_URL || 'https://swag-gold-react.vercel.app' },
};
export const OTHER_APP_ID = 'bullion';
