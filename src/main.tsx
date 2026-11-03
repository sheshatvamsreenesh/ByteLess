import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
<<<<<<< HEAD

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => console.warn('ByteLess offline app shell could not be registered.', error));
  });
}
=======
>>>>>>> c28e13279c20d61fb6ee7689b2138e9a45240fcf
