const express = require('express');
console.log('--- NODE BRIDGE STARTING ---');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logFile = path.join(os.homedir(), 'genga_bridge_debug.log');

function log(msg) {
    const text = `[${new Date().toISOString()}] ${msg}\n`;
    console.log(msg);
    try { fs.appendFileSync(logFile, text); } catch (e) { }
}

log('Bridge script loaded');

// Retry wrapper to handle ECONNRESET and transient network errors
async function withRetry(fn, label = 'Operation', maxAttempts = 3, delay = 1500) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            log(`${label} attempt ${attempt} failed: ${e.message}`);
            if (attempt < maxAttempts) {
                // Exponential backoff with jitter
                const backoff = delay * Math.pow(1.5, attempt - 1);
                await new Promise(r => setTimeout(r, backoff)); 
            }
        }
    }
    throw lastError;
}

// Global error handlers to prevent silent exits
process.on('uncaughtException', (err) => {
    log(`FATAL: Uncaught Exception: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
    log(`FATAL: Unhandled Rejection at: ${promise} reason: ${reason}`);
});

let MANGA, NEWS, ANIME, HiAnime;
try {
    const ext = require('@consumet/extensions');
    MANGA = ext.MANGA;
    NEWS = ext.NEWS;
    ANIME = ext.ANIME;
    HiAnime = require('@genga-movie/aniwatch').HiAnime;
    log('All extensions loaded successfully');
} catch (e) {
    log(`CRITICAL: Failed to load extensions: ${e.message}`);
    process.exit(1);
}

const app = express();
const port = 8001;

const hianime = new HiAnime();
const hianime2 = new ANIME.Hianime();
// Use AnimeSama instead of Gogoanime to avoid 'got-scraping' export errors in packaged app
let gogoanime;
try {
    gogoanime = new ANIME.AnimeSama(); 
} catch (e) {
    log(`Warning: Gogo fallback init failed: ${e.message}`);
    gogoanime = { search: () => ({ results: [] }), fetchAnimeInfo: () => ({ episodes: [] }) };
}
const mangapill = new MANGA.MangaPill();

app.use(express.json());
app.use((req, res, next) => {
    log(`${req.method} ${req.url}`);
    next();
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'NodeBridge', timestamp: new Date().toISOString() }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const getPoster = (it) => {
    let p = it.poster || it.image || it.thumbnail || it.cover || '';
    if (typeof p === 'string' && p.startsWith('//')) p = 'https:' + p;
    return p;
};

const normalize = (list) => (list || []).map(it => {
    const poster = getPoster(it);
    return {
        id: it.id,
        title: it.name || it.title || '',
        poster: poster,
        poster_url: poster, 
        source: 'hianime',
        type: 'anime',
        description: it.description || it.plot || ''
    };
});

// --- Anime ---
app.get('/anime/home', async (req, res) => {
    let groups = [];
    try {
        log('Attempting HiAnime Home...');
        const results = await withRetry(() => hianime.getHomePage(), 'HiAnime Home', 3, 1000);
        if (results) {
            if (results.spotlightAnimes?.length > 0) groups.push({ title: 'Spotlight', items: normalize(results.spotlightAnimes) });
            if (results.trendingAnimes?.length > 0)  groups.push({ title: 'Trending', items: normalize(results.trendingAnimes) });
            if (results.latestEpisodeAnimes?.length > 0) groups.push({ title: 'Latest Episodes', items: normalize(results.latestEpisodeAnimes) });
            if (results.mostPopularAnimes?.length > 0)   groups.push({ title: 'Most Popular', items: normalize(results.mostPopularAnimes) });
        }
    } catch (e) { log(`HiAnime Home failed: ${e.message}`); }

    if (groups.length === 0) {
        log('Falling back to Consumet Hianime search...');
        try {
            const results = await withRetry(() => hianime2.search('one piece'), 'Consumet HiAnime fallback', 2, 1000);
            if (results.results.length > 0) groups.push({ title: 'Recent Anime', items: normalize(results.results) });
        } catch (e2) { log(`Consumet Hianime search failed: ${e2.message}`); }
    }

    if (groups.length === 0) {
        log('Falling back to Gogoanime...');
        try {
            const results = await withRetry(() => gogoanime.search('popular'), 'Gogoanime fallback', 2, 1000);
            if (results.results.length > 0) groups.push({ title: 'Gogo Popular', items: normalize(results.results) });
        } catch (e3) { log(`Gogoanime search failed: ${e3.message}`); }
    }
    res.json(groups);
});

app.get('/anime/search', async (req, res) => {
    try {
        const { query } = req.query;
        log(`Anime Search requested: ${query}`);
        try { 
            const results = await withRetry(() => hianime.search(query), `HiAnime search: ${query}`, 2); 
            if (results && results.animes?.length > 0) {
                return res.json(normalize(results.animes)); 
            }
            throw new Error("No results from extension");
        }
        catch (e) { 
             log(`HiAnime Ext search failed: ${e.message}, trying hianime2`);
             try { 
                 const results = await withRetry(() => hianime2.search(query), `HiAnime2 search: ${query}`, 2); 
                 if (results && results.results?.length > 0) return res.json(normalize(results.results)); 
             }
             catch (e2) { log(`Hianime2 failed: ${e2.message}`); }

             // Custom Scraping Fallback (Axios + Cheerio)
             try {
                log(`Attempting direct HiAnime scraping for: ${query}`);
                const searchUrl = `https://hianime.to/search?keyword=${encodeURIComponent(query)}`;
                const { data: html } = await axios.get(searchUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' }
                });
                const $ = cheerio.load(html);
                const items = [];
                $('.film_list-wrap .flw-item').each((i, el) => {
                    const $el = $(el);
                    const id = $el.find('.film-poster a').attr('href')?.split('/').pop();
                    const title = $el.find('.film-name a').text().trim();
                    const poster = $el.find('img.film-poster-img').attr('data-src') || $el.find('img').attr('src');
                    if (id && title) items.push({ id, title, poster, poster_url: poster, source: 'hianime', type: 'anime' });
                });
                if (items.length > 0) return res.json(normalize(items));
             } catch (eScrape) { log(`Direct scrape failed: ${eScrape.message}`); }

             try {
                 log(`Trying Gogoanime fallback for: ${query}`);
                 const results = await withRetry(() => gogoanime.search(query), `Gogo search: ${query}`, 1); 
                 return res.json(normalize(results.results)); 
             } catch (e3) { 
                 log(`All anime search fallbacks failed`);
                 res.json([]); 
             }
        }
    } catch (err) { res.json([]); }
});

app.get('/anime/details/:id', async (req, res) => {
    try {
        const { id } = req.params;
        try { 
            const details = await withRetry(() => hianime.getInfo(id), `HiAnime info: ${id}`, 2);
            // Ensure poster is present in details
            if (details && !details.poster && details.image) details.poster = details.image;
            res.json(details); 
        }
        catch (e) {
            try {
                const results = await withRetry(() => hianime2.fetchAnimeInfo(id), `HiAnime2 info: ${id}`, 2);
                res.json({ id: results.id, name: results.title, poster: results.image, description: results.description, animeEpisodes: (results.episodes || []).map(ep => ({ number: ep.number, episodeId: ep.id, title: `Episode ${ep.number}` })) });
            } catch (e2) {
                try {
                    const results = await withRetry(() => gogoanime.fetchAnimeInfo(id), `Gogo info: ${id}`, 2);
                    res.json({ id: results.id, name: results.title, poster: results.image, description: results.description, animeEpisodes: (results.episodes || []).map(ep => ({ number: ep.number, episodeId: ep.id, title: `Episode ${ep.number}` })) });
                } catch (e3) { res.status(500).json({ error: e3.message }); }
            }
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/anime/episodes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        log(`Fetching Anime Episodes for: ${id}`);
        let episodes = [];
        try { 
            const results = await withRetry(() => hianime.getEpisodes(id), `HiAnime episodes: ${id}`, 2);
            episodes = results.episodes || results || [];
            log(`HiAnime Ext found ${episodes.length} episodes`);
        } catch (e) {
            log(`HiAnime Ext failed: ${e.message}, trying direct scrape`);
            try {
                const animeNumId = id.split('-').pop();
                const epUrl = `https://hianime.to/ajax/v2/episode/list/${animeNumId}`;
                log(`Scraping episodes directly from: ${epUrl}`);
                const { data } = await axios.get(epUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' },
                    timeout: 8000
                });
                
                if (data && data.html) {
                    const $ = cheerio.load(data.html);
                    $('.ssl-item.ep-item').each((i, el) => {
                        const $el = $(el);
                        episodes.push({
                            number: parseInt($el.attr('data-number') || i + 1),
                            episodeId: `${id}?ep=${$el.attr('data-id')}`,
                            title: $el.attr('title') || `Episode ${$el.attr('data-number') || i + 1}`
                        });
                    });
                    log(`Direct scrape found ${episodes.length} episodes`);
                }
                
                if (episodes.length === 0) throw new Error("Scrape returned 0 episodes");
            } catch (eScrape) {
                log(`Direct scrape failed: ${eScrape.message}, trying 3rd party providers...`);
                try {
                    const results = await withRetry(() => hianime2.fetchAnimeInfo(id), `HiAnime2 episodes fallback: ${id}`, 2);
                    episodes = (results.episodes || []).map(ep => ({ number: ep.number, episodeId: ep.id, title: ep.title || `Episode ${ep.number}` }));
                } catch (e2) {
                    try {
                        const results = await withRetry(() => gogoanime.fetchAnimeInfo(id), `Gogo episodes fallback: ${id}`, 2);
                        episodes = (results.episodes || []).map(ep => ({ number: ep.number, episodeId: ep.id, title: ep.title || `Episode ${ep.number}` }));
                    } catch (e3) {
                        log(`All anime episode fallbacks failed for ${id}`);
                    }
                }
            }
        }
        res.json({ status: 200, data: { episodes: episodes } });
    } catch (err) { 
        log(`Anime Episodes Global Error: ${err.message}`);
        res.json({ status: 200, data: { episodes: [] } }); 
    }
});

app.get('/anime/sources', async (req, res) => {
    const { episodeId, category } = req.query;
    log(`Fetching Anime Sources for: ${episodeId} (${category || 'sub'})`);
    try {
        try { 
            const results = await withRetry(() => hianime.getEpisodeSources(episodeId, 'hd-1', category || 'sub'), `HiAnime sources: ${episodeId}`, 2);
            log(`HiAnime Ext sources found`);
            res.json(results); 
        } catch (e) { 
             log(`HiAnime Ext sources failed: ${e.message}, trying fallbacks`);
             try { 
                const results = await withRetry(() => hianime2.fetchEpisodeSources(episodeId), `HiAnime2 sources fallback: ${episodeId}`, 1);
                log(`Fallback 1 sources found`);
                res.json(results);
             } catch (e2) { 
                log(`Fallback 1 sources failed: ${e2.message}, trying fallback 2`);
                try {
                    const results = await withRetry(() => gogoanime.fetchEpisodeSources(episodeId), `Gogo sources fallback: ${episodeId}`, 1);
                    log(`Fallback 2 sources found`);
                    res.json(results);
                } catch (e3) {
                    log(`All anime source fallbacks failed for ${episodeId}`);
                    res.status(500).json({ error: 'All providers failed' });
                }
             }
        }
    } catch (err) { 
        log(`Anime Sources Global Error: ${err.message}`);
        res.status(500).json({ error: err.message }); 
    }
});

// --- Manga (Refactor v3) ---

// 1. Details / Info (Must be specific to avoid conflicts)
app.get('/manga/mangapill/info', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).json({ error: 'Missing Manga ID' });
        log(`[Manga Bridge] Fetching Info: ${id}`);
        
        // Strip leading slash if present (Consumet library often adds it)
        const cleanId = id.startsWith('/') ? id.substring(1) : id;
        
        let info = null;
        try {
            info = await withRetry(() => mangapill.fetchMangaInfo(cleanId), `Manga info: ${cleanId}`, 2);
        } catch (e) {
            log(`[Manga Bridge] Fetch failed for ${cleanId} after all retries`);
            return res.status(500).json({ error: e.message });
        }
        
        if (info) {
            // Consistency fix for Consumet
            if (!info.chapters && info.results) info.chapters = info.results;
            
            const chapterCount = info.chapters ? info.chapters.length : 0;
            log(`[Manga Bridge] Success: "${info.title}" | ${chapterCount} chapters`);
            
            if (chapterCount === 0) {
                log(`[Manga Bridge] WARNING: No chapters found for ${cleanId}. Data: ${JSON.stringify(Object.keys(info))}`);
            }
            
            res.json(info);
        } else {
            log(`[Manga Bridge] 404: Manga not found for ${cleanId}`);
            res.status(404).json({ error: 'Manga not found' });
        }
    } catch (err) {
        log(`[Manga Bridge] Info Global Error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// 2. Read / Pages
app.get('/manga/mangapill/read', async (req, res) => {
    try {
        const id = req.query.chapterId || req.query.id;
        if (!id) return res.status(400).json({ error: 'Missing Chapter ID' });
        log(`[Manga Bridge] Fetching Pages: ${id}`);
        
        const cleanId = id.startsWith('/') ? id.substring(1) : id;
        const pages = await mangapill.fetchChapterPages(cleanId);
        
        log(`[Manga Bridge] Found ${pages ? pages.length : 0} pages`);
        res.json(pages || []);
    } catch(e) { 
        log(`[Manga Bridge] Read Error: ${e.message}`);
        res.status(500).json({ error: e.message }); 
    } 
});

// 3. Search
app.get(['/manga/mangapill/search', '/api/manga/search', '/manga/search'], async (req, res) => {
    try {
        const query = req.query.q || req.query.query || 'popular';
        const q = (query === 'popular' || query === 'trending') ? 'popular' : query;
        log(`[Manga Bridge] Search: ${q}`);
        
        const results = await mangapill.search(q);
        const list = results.results || results || [];
        log(`[Manga Bridge] Search results: ${list.length}`);
        res.json({ results: list });
    } catch (err) { 
        log(`[Manga Bridge] Search Error: ${err.message}`);
        res.json({ results: [] }); 
    }
});

// 4. Catch-all for legacy or other MangaPill routes (lowest priority)
app.get('/manga/mangapill/:param1', async (req, res) => {
    const p = req.params.param1;
    if (p === 'info' || p === 'read' || p === 'search') return; // Handled above
    
    log(`[Manga Bridge] Legacy Route Match: ${p}`);
    try {
        const results = await mangapill.search(p);
        res.json({ results: results.results || results || [] });
    } catch (e) { res.json({ results: [] }); }
});

// 5. Catch-all for catch-all (details/)*
app.get('/manga/details/*', async (req, res) => {
    const id = req.params[0];
    log(`[Manga Bridge] Catch-all details: ${id}`);
    // Redirect to info logic
    req.query.id = id;
    // We can't easily redirect internally without changing the URL and re-matching, 
    // so we duplicate the simple fetch or just call another handler.
    try {
        const info = await mangapill.fetchMangaInfo(id);
        if (!info.chapters && info.results) info.chapters = info.results;
        res.json(info);
    } catch (e) { res.status(500).json({ error: e.message }); }
});
// --- News ---
const axios = require('axios');
const cheerio = require('cheerio');
async function fetchNews() {
    return withRetry(async () => {
        log('Fetching latest news from ANN...');
        const resp = await axios.get('https://www.animenewsnetwork.com', {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' }
        });
        const html = resp.data;
        const news = [];
        const $ = cheerio.load(html);
        
        $('.herald.box.news').each((i, el) => {
            if (i >= 24) return false;
            const $el = $(el);
            const title = $el.find('h3 a').text().trim();
            const link = $el.find('h3 a').attr('href');
            let thumbnail = $el.find('div.thumbnail').attr('data-src') || $el.find('img').attr('src');
            
            if (title && link) {
                const fullLink = link.startsWith('http') ? link : 'https://www.animenewsnetwork.com' + link;
                if (thumbnail && !thumbnail.startsWith('http')) {
                    thumbnail = thumbnail.startsWith('//') ? 'https:' + thumbnail : 'https://www.animenewsnetwork.com' + thumbnail;
                }
                news.push({
                    id: link,
                    title: title,
                    thumbnail: thumbnail || 'https://www.animenewsnetwork.com/images/masthead/logo.png',
                    poster: thumbnail || 'https://www.animenewsnetwork.com/images/masthead/logo.png', // Add poster for UI consistency
                    url: fullLink
                });
            }
        });
        
        log(`Successfully parsed ${news.length} news items`);
        if (news.length === 0) throw new Error('No news found');
        return news;
    }, 'News fetch', 2, 2000);
}

app.get(['/news', '/news/latest'], async (req, res) => {
    try {
        const data = await fetchNews();
        res.json({ results: data });
    } catch (e) {
        log(`News route failed: ${e.message}`);
        res.json({ results: [] });
    }
});

app.get('/news/info', async (req, res) => { 
    try { 
        const { id } = req.query;
        log(`Fetching News Info for: ${id}`);
        // ID is already the relative path from fetchNews (e.g. /news/...)
        const result = await new NEWS.ANN().fetchNewsInfo(id);
        res.json(result); 
    } catch (err) { 
        log(`News Info Route Error: ${err.message}`);
        res.json({ title: 'News', content: 'Unavailable' }); 
    } 
});

app.listen(port, '127.0.0.1', () => { 
    log(`Bridge listening at http://127.0.0.1:${port}`); 
    // Heartbeat to confirm bridge is alive in logs
    setInterval(() => log('Heartbeat: Bridge is alive'), 30000);
});
