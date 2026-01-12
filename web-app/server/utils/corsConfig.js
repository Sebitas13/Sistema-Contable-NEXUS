/**
 * Enhanced CORS Configuration for Multi-Platform Deployment
 * Integrates with existing index.js to avoid conflicts
 */

const getCorsConfig = () => {
    const allowedOrigins = [];
    
    // Development environments
    if (process.env.NODE_ENV === 'development') {
        allowedOrigins.push(
            'http://localhost:3000',
            'http://localhost:5173',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:5173'
        );
    }
    
    // Production environments
    if (process.env.NODE_ENV === 'production') {
        // Vercel deployment
        if (process.env.VERCEL_URL) {
            allowedOrigins.push(process.env.VERCEL_URL);
        }
        
        // Render deployment
        if (process.env.RENDER_URL) {
            allowedOrigins.push(process.env.RENDER_URL);
        }
        
        // Custom production URL
        if (process.env.PRODUCTION_URL) {
            allowedOrigins.push(process.env.PRODUCTION_URL);
        }
        
        // Fallback for hardcoded production URLs
        allowedOrigins.push(
            'https://sistemacontablenexus.vercel.app',
            'https://sistema-contable.onrender.com'
        );
    }
    
    // Always include localhost for development/testing
    allowedOrigins.push(
        'http://localhost:3000',
        'http://localhost:5173'
    );
    
    console.log('🌐 CORS Origins:', allowedOrigins);
    
    return {
        origin: function (origin, callback) {
            // Allow requests with no origin (mobile apps, curl, etc.)
            if (!origin) {
                return callback(null, true);
            }
            
            // Check if origin is in allowed list
            const isAllowed = allowedOrigins.some(allowedOrigin => {
                // Handle wildcard subdomains
                if (allowedOrigin.includes('*')) {
                    return true;
                }
                
                // Exact match
                if (allowedOrigin === origin) {
                    return true;
                }
                
                // Subdomain match (for *.vercel.app, *.onrender.com)
                if (allowedOrigin.includes('*')) {
                    const baseDomain = allowedOrigin.replace('*', '');
                    return origin.endsWith(baseDomain);
                }
                
                return false;
            });
            
            if (isAllowed) {
                callback(null, true);
            } else {
                console.warn('🚫 CORS blocked origin:', origin);
                callback(new Error('Not allowed by CORS'));
            }
        },
        
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Requested-With',
            'X-API-Key',
            'Accept',
            'Origin'
        ],
        credentials: true, // Allow cookies/auth headers
        optionsSuccessStatus: 200 // Proper handling of preflight requests
    };
};

/**
 * Express middleware for CORS with error handling
 * NOTE: This is an alternative to the existing CORS in index.js
 * Use one or the other, not both simultaneously
 */
const corsMiddleware = (req, res, next) => {
    const corsConfig = getCorsConfig();
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
        res.header('Access-Control-Allow-Methods', corsConfig.methods.join(', '));
        res.header('Access-Control-Allow-Headers', corsConfig.allowedHeaders.join(', '));
        res.header('Access-Control-Allow-Credentials', 'true');
        return res.status(200).end();
    }
    
    // Apply CORS middleware
    require('cors')(corsConfig)(req, res, next);
};

module.exports = {
    getCorsConfig,
    corsMiddleware,
    // Helper to check if dynamic CORS should be used
    shouldUseDynamicCors: () => {
        return process.env.USE_DYNAMIC_CORS === 'true' || 
               process.env.NODE_ENV === 'production';
    }
};
