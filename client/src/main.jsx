import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { ThemeProvider } from '@/lib/ThemeContext'

// Apply the saved theme class before React renders to avoid a flash of wrong theme.
const savedTheme = localStorage.getItem('vanta-theme');
const prefersDark = savedTheme ? savedTheme === 'dark' : true;
document.documentElement.classList.toggle('dark', prefersDark);

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
)
