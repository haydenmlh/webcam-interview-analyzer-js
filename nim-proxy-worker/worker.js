const ALLOWED_PATHS = new Set(['/v1/models', '/v1/chat/completions'])
const ALLOWED_HEADERS = ['authorization', 'content-type', 'accept']
function buildCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept',
        'Access-Control-Max-Age': '86400',
    }
}

function jsonResponse(payload, status, corsHeaders = null) {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    }

    if (corsHeaders) {
        Object.assign(headers, corsHeaders)
    }

    return new Response(JSON.stringify(payload), {
        status,
        headers,
    })
}

function normalizePath(pathname) {
    if (!pathname) return '/'
    if (pathname.length > 1 && pathname.endsWith('/')) {
        return pathname.slice(0, -1)
    }
    return pathname
}

function isAllowedRequest(pathname, method) {
    const normalizedPath = normalizePath(pathname)
    if (!ALLOWED_PATHS.has(normalizedPath)) return false

    if (normalizedPath === '/v1/models') {
        return method === 'GET'
    }
    if (normalizedPath === '/v1/chat/completions') {
        return method === 'POST'
    }
    return false
}

function buildUpstreamHeaders(request) {
    const upstreamHeaders = new Headers()

    ALLOWED_HEADERS.forEach((headerName) => {
        const value = request.headers.get(headerName)
        if (value) {
            upstreamHeaders.set(headerName, value)
        }
    })

    return upstreamHeaders
}

export default {
    async fetch(request, env) {
        const corsHeaders = buildCorsHeaders()
        const requestUrl = new URL(request.url)
        const normalizedPath = normalizePath(requestUrl.pathname)

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders,
            })
        }

        if (!isAllowedRequest(normalizedPath, request.method)) {
            return jsonResponse(
                { error: 'Path or method is not allowed.' },
                405,
                corsHeaders,
            )
        }

        const upstreamBase = String(env?.NIM_UPSTREAM_BASE_URL || 'https://integrate.api.nvidia.com').replace(/\/+$/, '')
        const upstreamUrl = new URL(`${upstreamBase}${normalizedPath}${requestUrl.search || ''}`)

        let upstreamResponse
        try {
            upstreamResponse = await fetch(upstreamUrl.toString(), {
                method: request.method,
                headers: buildUpstreamHeaders(request),
                body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
            })
        } catch {
            return jsonResponse(
                { error: 'Upstream NVIDIA NIM request failed.' },
                502,
                corsHeaders,
            )
        }

        const responseHeaders = new Headers()
        const upstreamContentType = upstreamResponse.headers.get('Content-Type')
        if (upstreamContentType) {
            responseHeaders.set('Content-Type', upstreamContentType)
        }

        responseHeaders.set('Cache-Control', 'no-store')
        if (corsHeaders) {
            Object.entries(corsHeaders).forEach(([key, value]) => {
                responseHeaders.set(key, value)
            })
        }

        return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: responseHeaders,
        })
    },
}