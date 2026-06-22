import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { installAuthInterceptors } from './auth'

// Inyecta el token de auth en todas las llamadas al backend (fetch + axios) y maneja los 401.
installAuthInterceptors()

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
