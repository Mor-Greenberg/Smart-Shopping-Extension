// Runs the API server and the scraper microservice together, and shuts both
// down on Ctrl+C so neither is left holding a port.
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SERVICES = [
    { name: 'server ', file: 'server.js', port: 3000, color: '\x1b[35m' },
    { name: 'scraper', file: path.join('services', 'scraper.js'), port: 3001, color: '\x1b[36m' }
];

const RESET = '\x1b[0m';
const children = [];
let shuttingDown = false;

// Windows lets a second process bind an already-used port, after which traffic
// keeps going to the first one. Refusing to start is clearer than that.
function isPortBusy(port) {
    return new Promise((resolve) => {
        const socket = net.connect({ host: '127.0.0.1', port });
        const done = (busy) => {
            socket.destroy();
            resolve(busy);
        };
        socket.setTimeout(700);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });
}

function pipeWithPrefix(stream, label, color) {
    let buffer = '';

    stream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            process.stdout.write(`${color}[${label}]${RESET} ${line}\n`);
        }
    });
}

function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;

    for (const child of children) {
        if (!child.killed) child.kill();
    }

    process.exit(code);
}

async function main() {
    for (const service of SERVICES) {
        if (await isPortBusy(service.port)) {
            console.error(
                `Port ${service.port} is already in use, so ${service.name.trim()} was not started.\n` +
                'Close the process using it and run this command again.'
            );
            shutdown(1);
            return;
        }
    }

    for (const service of SERVICES) {
        const child = spawn(process.execPath, [service.file], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        pipeWithPrefix(child.stdout, service.name, service.color);
        pipeWithPrefix(child.stderr, service.name, service.color);

        child.on('exit', (code) => {
            if (shuttingDown) return;
            console.error(`\n${service.name.trim()} exited with code ${code}. Stopping everything.`);
            shutdown(code ?? 1);
        });

        children.push(child);
    }

    console.log('Server on http://localhost:3000, scraper on http://localhost:3001. Ctrl+C stops both.\n');
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.on(signal, () => shutdown(0));
}

main();
