/**
 * Minimal, dependency-free WebSocket server (RFC 6455) built on node:http.
 * Only what this game needs: text frames, ping/pong, close, fragmentation.
 */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1024 * 256;

export class WsConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.alive = true;
    this.closed = false;
    this._buf = Buffer.alloc(0);
    this._fragments = [];
    this._fragOpcode = 0;

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', (err) => this.emit('error', err));
    socket.on('close', () => { this.closed = true; this.emit('close'); });
    socket.setNoDelay(true);
  }

  _onData(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    while (this._parseFrame());
  }

  _parseFrame() {
    const buf = this._buf;
    if (buf.length < 2) return false;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < 4) return false;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return false;
      const hi = buf.readUInt32BE(2);
      const lo = buf.readUInt32BE(6);
      len = hi * 2 ** 32 + lo;
      offset = 10;
    }
    if (len > MAX_FRAME) { this.close(1009, 'frame too big'); return false; }

    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return false;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + len) return false;

    let payload = buf.subarray(offset, offset + len);
    if (maskKey) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    }
    this._buf = buf.subarray(offset + len);

    switch (opcode) {
      case 0x0: // continuation
        this._fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(this._fragments);
          this._fragments = [];
          this._emitPayload(this._fragOpcode, full);
        }
        break;
      case 0x1:
      case 0x2:
        if (fin) this._emitPayload(opcode, payload);
        else { this._fragOpcode = opcode; this._fragments = [payload]; }
        break;
      case 0x8:
        this.close(1000);
        break;
      case 0x9:
        this._sendFrame(0xA, payload);
        break;
      case 0xA:
        this.alive = true;
        break;
      default:
        break;
    }
    return true;
  }

  _emitPayload(opcode, payload) {
    const text = payload.toString('utf8');
    if (opcode === 0x1) {
      try { this.emit('message', JSON.parse(text)); }
      catch { this.emit('badMessage', text); }
    } else {
      this.emit('binary', payload);
    }
  }

  _sendFrame(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    header[0] = 0x80 | opcode;
    try { this.socket.write(Buffer.concat([header, payload])); }
    catch { /* socket already gone */ }
  }

  send(obj) {
    this._sendFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  ping() {
    this._sendFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this._sendFrame(0x8, payload);
    this.closed = true;
    try { this.socket.end(); } catch { /* ignore */ }
  }
}

/** Upgrade an http.Server to speak WebSocket at `path`. */
export function attachWebSocketServer(httpServer, path, onConnection) {
  httpServer.on('upgrade', (req, socket, head) => {
    const url = (req.url || '').split('?')[0];
    if (url !== path) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const conn = new WsConnection(socket);
    if (head && head.length) conn._onData(head);
    onConnection(conn, req);
  });

  // Reap dead connections.
  const clients = new Set();
  const interval = setInterval(() => {
    for (const c of clients) {
      if (c.alive === false) { c.close(1001); clients.delete(c); continue; }
      c.alive = false;
      c.ping();
    }
  }, 25000);
  interval.unref?.();

  return {
    clients,
    track(conn) {
      clients.add(conn);
      conn.on('close', () => clients.delete(conn));
    },
    broadcast(obj) {
      for (const c of clients) c.send(obj);
    },
    shutdown() {
      clearInterval(interval);
      for (const c of clients) c.close(1001, 'server shutdown');
    }
  };
}
