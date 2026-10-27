import { useState } from 'react';
import Modal from './Modal.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';

const STEPS = [
  { titleKey: 'tour.step1Title', bodyKey: 'tour.step1Body' },
  { titleKey: 'tour.step2Title', bodyKey: 'tour.step2Body' },
  { titleKey: 'tour.step3Title', bodyKey: 'tour.step3Body' },
  { titleKey: 'tour.step4Title', bodyKey: 'tour.step4Body' },
  { titleKey: 'tour.step5Title', bodyKey: 'tour.step5Body' },
];

export default function WelcomeTour({ onClose }) {
  const { t } = useLanguage();
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;

  function finish() {
    localStorage.setItem('sg_tour_seen', '1');
    onClose();
  }

  return (
    <Modal title={t(STEPS[step].titleKey)} onClose={finish} width={420}>
      <p style={{ color: 'var(--cream-dim)', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
        {t(STEPS[step].bodyKey)}
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{
            height: 4, flex: 1, borderRadius: 2,
            background: i <= step ? 'var(--gold-21)' : 'var(--surface-3)',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button className="btn ghost" onClick={finish}>{t('common.skip')}</button>
        <button className="btn gold" onClick={() => isLast ? finish() : setStep(s => s + 1)}>
          {isLast ? t('tour.gotit') : t('common.next')}
        </button>
      </div>
    </Modal>
  );
}
