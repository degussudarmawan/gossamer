import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
// Fonts are bundled with the app rather than fetched from Google, so visiting
// an anonymous support site doesn't tell a third party you were here.
import '@fontsource-variable/quicksand';
import './styles/index.css';
import App from './App';
import { applyTheme, loadTheme } from './theme';

// before the first paint, so the page never flashes the wrong background
applyTheme(loadTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* reducedMotion="user": Motion animations switch off for people whose device asks for less motion. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
