export const HTTP_GET = 'GET';
export const HTTP_PUT = 'PUT';
export const HTTP_POST = 'POST';
export const HTTP_PATCH = 'PATCH';
export const HTTP_DELETE = 'DELETE';

export const HTTP_STATUS_OK = 200;
export const HTTP_STATUS_CREATED = 201;
export const HTTP_STATUS_PARTIAL_CONTENT = 206;
export const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;

export const ERROR_ABORT = 'AbortError';
export const ERROR_TYPE = 'TypeError';

export const defaultJSON = {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
};

export const cacheRequest = 'request';

export const pool = (() => {
    let cachePool = null;

    return {
        getInstance: (name) => {
            if (!cachePool || !cachePool.has(name)) {
                throw new Error(`please init cache first: ${name}`);
            }
            return cachePool.get(name);
        },
        restart: async (name) => {
            cachePool.set(name, null);
            cachePool.delete(name);
            await window.caches.delete(name);
            await window.caches.open(name).then((c) => cachePool.set(name, c));
        },
        init: (callback, lists = []) => {
            cachePool = new Map();
            Promise.all(lists.concat([cacheRequest]).map((v) => window.caches.open(v).then((c) => cachePool.set(v, c)))).then(() => callback());
        },
    };
})();

export const cacheWrapper = (cacheName) => {
    const cacheObject = pool.getInstance(cacheName);

    const set = (input, res, forceCache, ttl) => res.clone().arrayBuffer().then((ab) => {
        if (!res.ok) {
            return res;
        }

        const now = new Date();
        const headers = new Headers(res.headers);

        if (!headers.has('Date')) {
            headers.set('Date', now.toUTCString());
        }

        if (forceCache || !headers.has('Cache-Control')) {
            if (!forceCache && headers.has('Expires')) {
                const expTime = new Date(headers.get('Expires'));
                ttl = Math.max(0, expTime.getTime() - now.getTime());
            }

            if (ttl === 0) {
                throw new Error('Cache max age cannot be 0');
            }

            headers.set('Cache-Control', `public, max-age=${Math.floor(ttl / 1000)}`);
        }

        if (!headers.has('Content-Length')) {
            headers.set('Content-Length', String(ab.byteLength));
        }

        return cacheObject.put(input, new Response(ab, { headers })).then(() => res);
    });

    const has = (input) => cacheObject.match(input).then((res) => {
        if (!res) {
            return null;
        }

        const maxAge = res.headers.get('Cache-Control').match(/max-age=(\d+)/)[1];
        const expTime = Date.parse(res.headers.get('Date')) + (parseInt(maxAge) * 1000);

        return Date.now() > expTime ? null : res;
    });

    const del = (input) => cacheObject.delete(input);

    return {
        set,
        has,
        del,
    };
};

export const request = (method, path) => {
    const ac = new AbortController();
    const req = {
        signal: ac.signal,
        credential: 'include',
        headers: new Headers(defaultJSON),
        method: String(method).toUpperCase(),
    };

    let reqTtl = 0;
    let reqRetry = 2;       // Suaviza para evitar rate limit
    let reqDelay = 3000;    // Janela estável de 3 segundos
    let reqAttempts = 0;
    let reqNoBody = false;
    let reqForceCache = false;

    let callbackFunc = null;

    const baseFetch = (input) => {
        const abstractFetch = () => {
            const wrapperFetch = () => window.fetch(input, req).then(async (res) => {
                if (reqNoBody) {
                    ac.abort();
                    return new Response(null, {
                        status: res.status,
                        statusText: res.statusText,
                        headers: new Headers(res.headers),
                    });
                }

                if (!res.ok || !callbackFunc) {
                    return res;
                }

                const contentLength = parseInt(res.headers.get('Content-Length') ?? 0);
                if (contentLength === 0) {
                    return res;
                }

                const chunks = [];
                let receivedLength = 0;
                const reader = res.body.getReader();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }

                    chunks.push(value);
                    receivedLength += value.length;

                    await callbackFunc(receivedLength, contentLength, window.structuredClone ? window.structuredClone(chunks) : chunks);
                }

                const contentType = res.headers.get('Content-Type') ?? 'application/octet-stream';
                return new Response(new Blob(chunks, { type: contentType }), {
                    status: res.status,
                    statusText: res.statusText,
                    headers: new Headers(res.headers),
                });
            });

            if (reqTtl === 0 || reqNoBody) {
                return wrapperFetch();
            }

            if (req.method !== HTTP_GET) {
                return wrapperFetch();
            }

            const cw = cacheWrapper(cacheRequest);

            return cw.has(input).then((res) => {
                if (res) {
                    return Promise.resolve(res);
                }
                return cw.del(input).then(wrapperFetch).then((r) => cw.set(input, r, reqForceCache, reqTtl));
            });
        };

        const attempt = async () => {
            try {
                return await abstractFetch();
            } catch (error) {
                if (error.name === ERROR_ABORT) {
                    throw error;
                }

                reqAttempts++;

                if (reqAttempts > reqRetry) {
                    return new Response(JSON.stringify({ status: false, data: { data: [], total: 0 } }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                await new Promise((resolve) => window.setTimeout(resolve, reqDelay * 2));
                return attempt();
            }
        };

        return attempt();
    };

    const baseDownload = (res) => {
        if (res.status !== HTTP_STATUS_OK) {
            return Promise.resolve(res);
        }
        return Promise.resolve(res);
    };

    return {
        token: (token) => {
            if (token) {
                req.headers.set('X-Token', token);
            }
            return this;
        },
        addHeader: (key, value) => {
            req.headers.set(key, value);
            return this;
        },
        retry: (count, delay) => {
            reqRetry = count;
            reqDelay = delay;
            return this;
        },
        cache: (ttl, force = false) => {
            reqTtl = ttl;
            reqForceCache = force;
            return this;
        },
        progress: (callback) => {
            callbackFunc = callback;
            return this;
        },
        nobody: () => {
            reqNoBody = true;
            return this;
        },
        json: (body) => {
            req.body = JSON.stringify(body);
            return baseFetch(path).then((res) => {
                if (res.status === HTTP_STATUS_INTERNAL_SERVER_ERROR) {
                    throw new Error('internal server error');
                }
                return res.json();
            });
        },
        fetch: () => baseFetch(path).then((res) => {
            if (res.status === HTTP_STATUS_INTERNAL_SERVER_ERROR) {
                throw new Error('internal server error');
            }
            return res;
        }),
        download: (name, ext) => {
            return baseFetch(path).then(baseDownload);
        }
    };
};
