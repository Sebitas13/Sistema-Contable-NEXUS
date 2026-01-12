import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './assets/bootstrap/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import { loadBootstrap } from './bootstrapLoader.js'

// Cargar Bootstrap JS dinámicamente
loadBootstrap();

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
