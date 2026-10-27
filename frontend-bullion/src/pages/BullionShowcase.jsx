import { useLanguage } from '../context/LanguageContext.jsx';
import IntroAnimation from '../components/ui/scroll-morph-hero.tsx';

export default function BullionShowcase() {
  const { t } = useLanguage();
  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{t('show.title')}</div>
          <div className="page-subtitle">{t('show.scroll')}</div>
        </div>
      </div>
      <div className="panel" style={{ padding: 0, overflow: 'hidden', height: 'clamp(360px, 70vh, 700px)' }}>
        <IntroAnimation />
      </div>
    </section>
  );
}
