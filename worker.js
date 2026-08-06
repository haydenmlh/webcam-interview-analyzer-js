export default {
async fetch(request) {
const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
"Access-Control-Allow-Headers": "Authorization,Content-Type"
}

if (request.method === "OPTIONS") {
return new Response(null, { status: 204, headers: corsHeaders })
}

const url = new URL(request.url)
const target = new URL("https://integrate.api.nvidia.com")
target.pathname = url.pathname
target.search = url.search

const upstream = await fetch(target.toString(), {
method: request.method,
headers: request.headers,
body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body
})

const respHeaders = new Headers(upstream.headers)
Object.entries(corsHeaders).forEach(([k, v]) => respHeaders.set(k, v))

return new Response(upstream.body, {
status: upstream.status,
statusText: upstream.statusText,
headers: respHeaders
})
}
}