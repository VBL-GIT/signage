import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { LightboxProvider } from './components/Lightbox';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LightboxProvider>
        <App />
      </LightboxProvider>
    </BrowserRouter>
  </React.StrictMode>
);
