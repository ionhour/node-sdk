import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/**
 * A real HTTP server for SDK tests (no mocking libraries). Records every
 * request and lets each test drive the response. Excluded from the published
 * build via tsconfig.lib `exclude`.
 */
export interface CapturedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: string;
}

export interface StubResponse {
  status?: number;
  body?: string;
}

export type Responder = (request: CapturedRequest, callIndex: number) => StubResponse;

export interface TestServer {
  baseUrl: string;
  readonly requests: CapturedRequest[];
  close: () => Promise<void>;
}

const OK_BODY = JSON.stringify({ message: 'OK' });

export async function startTestServer(responder?: Responder): Promise<TestServer> {
  const requests: CapturedRequest[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const captured: CapturedRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      const callIndex = requests.length;
      requests.push(captured);
      const stub = responder?.(captured, callIndex) ?? {};
      res.statusCode = stub.status ?? 200;
      res.setHeader('content-type', 'application/json');
      res.end(stub.body ?? OK_BODY);
    });
  });

  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  let closed = false;
  return {
    baseUrl,
    requests,
    // Idempotent: safe to call more than once (tests + afterEach teardown).
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (closed) {
          resolve();
          return;
        }
        closed = true;
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Starts then immediately closes a server, yielding a base URL that refuses
 * connections — used to simulate a transport error. */
export async function unreachableBaseUrl(): Promise<string> {
  const server = await startTestServer();
  const { baseUrl } = server;
  await server.close();
  return baseUrl;
}
