import { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext.jsx';
import AnimatedText from './AnimatedText.jsx';
import { Typewriter } from './ui/typewriter.tsx';

// A one-time full-name greeting shown right after login. Shows once per
// login (a sessionStorage flag set by Login.jsx), then fades itself out.
export default function WelcomeGreeting({ name }) {
  const { t, lang } = useLanguage();
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const stay = setTimeout(() => setLeaving(true), 2600);
    const hide = setTimeout(() => setVisible(false), 3100);
    return () => { clearTimeout(stay); clearTimeout(hide); };
  }, []);

  if (!visible) return null;

  return (
    <div className={`welcome-greeting-overlay${leaving ? ' leaving' : ''}`}>
      <div className="welcome-greeting-inner">
        <div className="welcome-greeting-sub">
          <Typewriter
            text={lang === 'ar' ? 'السلام عليكم' : t('welcome.greetingSub')}
            speed={55}
            loop={false}
            showCursor={false}
          />
        </div>
        <AnimatedText
          text={name}
          as="h1"
          textClassName="welcome-greeting-name"
          duration={0.4}
          delay={0.08}
        />
      </div>
    </div>
  );
}
