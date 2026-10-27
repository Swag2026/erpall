import ConcentricRingsLoader from './ui/loading-animation-1.tsx';
import { useLanguage } from '../context/LanguageContext.jsx';

// Full-area loading screen (rings loader ported from Swag Maintenance).
export default function AppLoader({ minHeight = '60vh' }) {
  const { t } = useLanguage();
  return (
    <div style={{ minHeight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <ConcentricRingsLoader size={120} color="#D4AA30" text={t('common.loading')} />
    </div>
  );
}
