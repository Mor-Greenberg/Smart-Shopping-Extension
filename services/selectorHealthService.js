const { SITES_CONFIG, isSiteEnabled } = require('../config');
const HEALTH_PROBES = require('../config/healthProbes');
const { requestSelectorProbe, formatScraperError } = require('./scraperClient');

let healthCheckRunning = false;

function isHealthCheckRunning() {
    return healthCheckRunning;
}

async function insertHealthLog(pool, { checkType, siteKey, status, message, latencyMs }) {
    await pool.query(
        `INSERT INTO health_logs (check_type, site_key, status, message, latency_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [checkType, siteKey, status, message, latencyMs]
    );
}

function brokenMessage(result) {
    const parts = ['Scraper Broken'];
    if (result.error) parts.push(result.error);
    if (result.httpStatus && result.httpStatus >= 400) parts.push(`HTTP ${result.httpStatus}`);
    if (result.titleFound === false) parts.push('Title selector failed');
    if (result.priceFound === false) parts.push('Price selector failed');
    return parts.join(': ');
}

async function checkOneSite(pool, probe, log) {
    const siteSettings = SITES_CONFIG[probe.siteKey];
    const started = Date.now();

    if (!siteSettings || !isSiteEnabled(siteSettings)) {
        return {
            siteKey: probe.siteKey,
            skipped: true,
            status: 'skipped',
            message: 'Site disabled'
        };
    }

    let result;
    try {
        result = await requestSelectorProbe({
            url: probe.url,
            siteSettings,
            titleSelectors: probe.titleSelectors
        });
    } catch (err) {
        const details = formatScraperError(err);
        result = { ok: false, error: details.message };
    }

    const latencyMs = Date.now() - started;
    const broken = result.ok !== true;
    const status = broken ? 'broken' : 'healthy';
    const message = broken
        ? brokenMessage(result)
        : `Selectors OK (title, price=${result.price})`;

    await insertHealthLog(pool, {
        checkType: 'selector_probe',
        siteKey: probe.siteKey,
        status,
        message,
        latencyMs
    });

    log(broken ? 'WARN' : 'INFO', 'Selector health check', {
        site: probe.siteKey,
        status,
        latencyMs,
        message
    });

    return {
        siteKey: probe.siteKey,
        url: probe.url,
        status,
        message,
        latencyMs,
        titleFound: Boolean(result.titleFound),
        priceFound: Boolean(result.priceFound),
        price: result.price || null
    };
}

async function runSelectorHealthChecks(pool, log = console.log) {
    if (healthCheckRunning) {
        return { ok: false, skipped: true, reason: 'A health check is already running' };
    }

    healthCheckRunning = true;
    const results = [];
    try {
        log('INFO', 'Selector health check started', { sites: HEALTH_PROBES.map((p) => p.siteKey) });
        for (const probe of HEALTH_PROBES) {
            try {
                results.push(await checkOneSite(pool, probe, log));
            } catch (err) {
                const message = `Scraper Broken: ${err.message || 'check failed'}`;
                await insertHealthLog(pool, {
                    checkType: 'selector_probe',
                    siteKey: probe.siteKey,
                    status: 'broken',
                    message,
                    latencyMs: null
                });
                log('ERROR', 'Selector health check failed', { site: probe.siteKey, error: err.message });
                results.push({
                    siteKey: probe.siteKey,
                    status: 'broken',
                    message
                });
            }
        }
        return { ok: true, results };
    } finally {
        healthCheckRunning = false;
    }
}

module.exports = {
    runSelectorHealthChecks,
    isHealthCheckRunning
};
