import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './workflow.css';
import './todo-panel-theme.css';
import './light-theme.css';

createRoot(document.getElementById('root')).render(<App />);
