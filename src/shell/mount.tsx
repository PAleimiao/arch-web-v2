import { createRoot } from 'react-dom/client';
import { createElement, StrictMode } from 'react';
import App from './App';

const container = document.getElementById('os-root');
if (!container) throw new Error('#os-root 容器缺失');

createRoot(container).render(
  createElement(StrictMode, null, createElement(App)),
);
