/**
 * Keep-Alive Service for Backend Node ↔ Python Communication
 * Prevents cold starts and handles reconnection logic
 */

const axios = require('axios');
const AI_ENGINE_URL = process.env.AI_ENGINE_URL || process.env.AI_ENGINE_URL_ALT || 'http://localhost:8000';

class KeepAliveService {
    constructor() {
        this.isRunning = false;
        this.interval = null;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.healthCheckInterval = 14 * 60 * 1000; // 14 minutes
        this.requestTimeout = 30000; // 30 seconds
    }

    /**
     * Start the keep-alive service
     */
    start() {
        if (this.isRunning) {
            console.log('🔄 Keep-alive service already running');
            return;
        }

        this.isRunning = true;
        this.retryCount = 0;
        
        console.log('🔄 Starting keep-alive service for AI engine');
        this.scheduleNextHealthCheck();
        
        // Initial health check
        this.performHealthCheck();
    }

    /**
     * Stop the keep-alive service
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        
        this.isRunning = false;
        console.log('⏹ Keep-alive service stopped');
    }

    /**
     * Schedule next health check
     */
    scheduleNextHealthCheck() {
        this.interval = setTimeout(() => {
            this.performHealthCheck();
        }, this.healthCheckInterval);
    }

    /**
     * Perform health check with retry logic
     */
    async performHealthCheck() {
        try {
            console.log('🔍 Performing health check on AI engine...');
            
            const response = await axios.get(`${AI_ENGINE_URL}/health`, {
                timeout: this.requestTimeout,
                headers: {
                    'User-Agent': 'Sistema-Contable-KeepAlive/1.0'
                }
            });

            if (response.status === 200) {
                console.log('✅ AI engine is healthy');
                this.retryCount = 0; // Reset retry count on success
            } else {
                throw new Error(`Health check failed with status ${response.status}`);
            }

        } catch (error) {
            this.retryCount++;
            console.error(`❌ Health check failed (attempt ${this.retryCount}/${this.maxRetries}):`, error.message);
            
            if (this.retryCount >= this.maxRetries) {
                console.error('🚨 AI engine appears to be down after multiple retries');
                // Could trigger alert or fallback logic here
            }
        }

        // Schedule next check if service is still running
        if (this.isRunning) {
            this.scheduleNextHealthCheck();
        }
    }

    /**
     * Make API calls with automatic retry logic
     * @param {string} method - HTTP method
     * @param {string} url - API endpoint
     * @param {Object} data - Request data
     * @param {Object} options - Additional options
     * @returns {Promise} - API response
     */
    async makeAPICall(method, url, data = null, options = {}) {
        let lastError;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const config = {
                    method,
                    url,
                    timeout: this.requestTimeout,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Sistema-Contable/1.0',
                        ...options.headers
                    },
                    ...options
                };

                if (data) {
                    config.data = data;
                }

                const response = await axios(config);
                
                // Reset retry count on success
                this.retryCount = 0;
                return response;
                
            } catch (error) {
                lastError = error;
                console.warn(`🔄 API call attempt ${attempt} failed:`, error.message);
                
                // Wait before retry (exponential backoff)
                if (attempt < this.maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw lastError;
    }
}

// Singleton instance
const keepAliveService = new KeepAliveService();

module.exports = keepAliveService;
