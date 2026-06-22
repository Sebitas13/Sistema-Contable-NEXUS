import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API_URL from '../api';
import { setToken } from '../auth';

export default function Login() {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success && data.token) {
                setToken(data.token);
                navigate('/', { replace: true });
            } else {
                setError(data.error || 'Contraseña incorrecta.');
            }
        } catch (err) {
            setError('No se pudo conectar con el servidor. Intenta de nuevo en unos segundos.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="d-flex justify-content-center align-items-center p-3"
            style={{ minHeight: '100vh' }}
        >
            <div
                className="glass-panel p-4 p-md-5 shadow-lg w-100"
                style={{ maxWidth: '420px', borderRadius: '1rem' }}
            >
                <div className="text-center mb-4">
                    <i
                        className="bi bi-shield-lock-fill"
                        style={{ fontSize: '2.5rem', color: 'var(--accent-primary)' }}
                    ></i>
                    <h4 className="mt-3 mb-1 fw-bold">Sistema Contable</h4>
                    <small className="text-white-50">Ingresa la contraseña para continuar</small>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="mb-3">
                        <label className="form-label small text-white-50">Contraseña</label>
                        <input
                            type="password"
                            className="form-control"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoFocus
                            autoComplete="current-password"
                            placeholder="••••••••"
                        />
                    </div>

                    {error && (
                        <div className="alert alert-danger py-2 small" role="alert">
                            <i className="bi bi-exclamation-triangle-fill me-2"></i>
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary w-100 d-flex justify-content-center align-items-center"
                        disabled={loading || !password}
                    >
                        {loading ? (
                            <>
                                <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                                Verificando...
                            </>
                        ) : (
                            <>
                                <i className="bi bi-box-arrow-in-right me-2"></i>
                                Entrar
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
