/**
 * Minimal local HTTP CONNECT proxy with its own DNS (1.1.1.1 / 8.8.8.8, falling back
 * to the system resolver). Purpose: the workstation extract streams tens of GB from
 * S3 and some home routers' DNS forwarders flake under that load, killing the scan.
 * Pointing DuckDB's httpfs at this proxy (DUCKDB_HTTP_PROXY=127.0.0.1:8118) keeps
 * TLS end-to-end (CONNECT tunnel — certificates still validated against the real
 * hostname) while name resolution happens here, immune to the router.
 *
 *   npx tsx scripts/net-proxy.ts [port]
 */
import net from "node:net";
import dns from "node:dns";

const PORT = Number(process.argv[2] ?? 8118);
const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

const cache = new Map<string, { ip: string; at: number }>();

async function resolveHost(host: string): Promise<string> {
  if (net.isIP(host)) return host;
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < 120_000) return hit.ip;
  let ip: string | undefined;
  try {
    ip = (await resolver.resolve4(host))[0];
  } catch {
    // public resolvers unreachable — fall back to the system resolver
    ip = (await dns.promises.lookup(host, { family: 4 })).address;
  }
  if (!ip) throw new Error(`no A record for ${host}`);
  cache.set(host, { ip, at: Date.now() });
  return ip;
}

const server = net.createServer((client) => {
  let buf = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      if (buf.length > 16384) client.destroy();
      return;
    }
    client.off("data", onData);
    const head = buf.subarray(0, headerEnd).toString("utf8");
    const m = /^CONNECT\s+([^\s:]+):(\d+)\s+HTTP\/1\.[01]/.exec(head);
    if (!m) {
      client.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n");
      return;
    }
    const [, host, port] = m;
    resolveHost(host)
      .then((ip) => {
        const upstream = net.connect(Number(port), ip, () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          const rest = buf.subarray(headerEnd + 4);
          if (rest.length) upstream.write(rest);
          client.pipe(upstream).pipe(client);
        });
        upstream.on("error", () => client.destroy());
        client.on("error", () => upstream.destroy());
        client.on("close", () => upstream.destroy());
      })
      .catch(() => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
  };
  client.on("data", onData);
  client.on("error", () => {});
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[net-proxy] CONNECT proxy on 127.0.0.1:${PORT} · DNS via 1.1.1.1/8.8.8.8 (system fallback)`);
});
