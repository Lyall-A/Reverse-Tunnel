const net = require("net");
const tls = require("tls");

const { parsePackets, sendPackets } = require("./packet");

const { serverHost, authorization, heartbeatInterval, heartbeatDifference, relayPort, forwardPort } = require("./relay.config.json");

const relayServer = net.createServer();
const forwardServer = net.createServer();

let server = null;
const connections = [];

relayServer.on("connection", socket => {
    const address = socket.remoteAddress?.split("::ffff:")[1];

    if (server) return socket.destroy();
    if (address !== serverHost) return socket.destroy();

    let heartbeatTimeout;
    let pingDate = null;

    console.log("Server connected");

    server = {
        socket,
        address,
        handshaked: false,
        lastHeartbeat: null
    };

    socket.on("data", i => {
        const packets = parsePackets(i);

        for (const packet of packets) {
            const { headers, data } = packet;

            // console.log(`Received ${headers.action}`);

            // HANDSHAKE
            if (headers.action === "HANDSHAKE" && !server.handshaked) {
                if (!authorization || headers.additional.authorization === authorization) {
                    console.log("Server authorized");
                    server.handshaked = true;
                    sendHello();
                    heartbeatTimeout = setTimeout(() => { if (!server.lastHeartbeat || (Date.now() - server.lastHeartbeat) > (heartbeatInterval + heartbeatDifference)) destroy("Heartbeat timeout") }, heartbeatInterval + heartbeatDifference);

                    // setInterval(() => {
                    //     pingDate = Date.now();
                    //     sendPing();
                    // }, 1000);
                }
            }

            if (!server.handshaked) return destroy("Server did not authorize");

            // PING
            if (headers.action === "PING") {
                sendPong();
            }

            // PONG
            if (headers.action === "PONG") {
                if (pingDate) {
                    console.log("Ping:", Date.now() - pingDate);
                    pingDate = null;
                }
            }

            // HEARTBEAT
            if (headers.action === "HEARTBEAT") {
                clearTimeout(heartbeatTimeout);
                heartbeatTimeout = setTimeout(() => { if (!server.lastHeartbeat || (Date.now() - server.lastHeartbeat) > (heartbeatInterval + heartbeatDifference)) destroy("Heartbeat timeout") }, heartbeatInterval + heartbeatDifference);
                sendHeartbeatAck();
            }

            // CONNETION_CREATED
            if (headers.action === "CONNECTION_CREATED") {
                const id = headers.additional.id;
                if (!id) return destroy("Received CONNECTION_CREATED with no ID");

                const connection = connections.find(i => i.id === id);
                if (!connection) return;

                sendConnectionCreatedAck(id);

                connection.created = true;
                connection.sendQueue();
            }

            // DATA
            if (headers.action === "DATA") {
                const id = headers.additional.id;
                if (!id) return destroy("Received DATA with no ID");

                const connection = connections.find(i => i.id === id);
                if (!connection) return;

                connection.send(data);
            }

            // CLOSE
            if (headers.action === "CLOSE") {
                const id = headers.additional.id;
                if (!id) return destroy("Received CLOSE with no ID");

                const connection = connections.find(i => i.id === id);
                if (!connection) return;

                connection.socket.end();
            }
        }
    });

    socket.on("close", () => {
        clearTimeout(heartbeatTimeout);
        while (connections[0]) {
            connections[0].socket.destroy();
            connections.shift();
        }
        console.log("Server closed");
        server = null;
    });
    socket.on("error", err => {
        console.log("Server errored:", err);
    });

    function destroy(message) {
        if (message) console.log(message);
        socket.destroy();
    }

    function sendHello() {
        console.log("Sending HELLO");
        return sendPackets(socket, [{
            headers: {
                version: 1,
                action: "HELLO",
                additional: {
                    heartbeat_interval: heartbeatInterval
                }
            }
        }]);
    }

    function sendPing() {
        // console.log("Sending PING");
        return sendPackets(socket, [{
            headers: {
                version: 1,
                action: "PING"
            }
        }]);
    }

    function sendPong() {
        // console.log("Sending PONG");
        return sendPackets(socket, [{
            headers: {
                version: 1,
                action: "PONG"
            }
        }]);
    }

    function sendHeartbeatAck() {
        // console.log("Sending HEARTBEAT_ACK")
        return sendPackets(socket, [{
            headers: {
                version: 1,
                action: "HEARTBEAT_ACK"
            }
        }]);
    }

    function sendConnectionCreatedAck(id) {
        // console.log("Sending CONNECTION_CREATED_ACK")
        return sendPackets(socket, [{
            headers: {
                version: 1,
                action: "CONNECTION_CREATED_ACK",
                additional: { id }
            }
        }]);
    }
});

forwardServer.on("connection", socket => {
    if (!server) return socket.destroy();

    const id = genId();
    const queue = [];
    const address = socket.remoteAddress?.split("::ffff:")[1];

    const connection = {
        socket,
        id,
        created: false,
        queue,
        sendQueue,
        send,
        close,
        address
    };

    connections.push(connection);

    sendNewConnection();

    socket.on("data", data => {
        if (connection.created) {
            sendData(data);
        } else {
            queue.push(data);
        }
    });
    socket.on("close", close);
    socket.on("end", close);
    socket.on("error", close);

    function close() {
        const foundConnection = connections.findIndex(i => i.id === id);
        if (foundConnection < 0) return;
        connections.splice(foundConnection, 1);
        sendClose();
    }

    function send(data) {
        // TODO: handle large data correctly
        socket.write(data);
    }

    function sendQueue() {
        while (queue[0]) {
            sendData(queue[0]);
            queue.shift();
        }
    }

    function sendNewConnection() {
        // console.log("Sending NEW_CONNECTION");
        return sendPackets(server.socket, [{
            headers: {
                version: 1,
                action: "NEW_CONNECTION",
                additional: { id }
            }
        }]);
    }

    function sendData(data) {
        // console.log("Sending DATA");
        return sendPackets(server.socket, [{
            headers: {
                version: 1,
                action: "DATA",
                dataLength: data.byteLength,
                additional: { id }
            },
            data
        }]);
    }

    function sendClose() {
        // console.log("Sending CLOSE");
        return sendPackets(server.socket, [{
            headers: {
                version: 1,
                action: "CLOSE",
                additional: { id }
            }
        }]);
    }
});

relayServer.listen(relayPort, () => console.log(`Relay server listening at :${relayPort}`));
forwardServer.listen(forwardPort, () => console.log(`Forward server listening at :${forwardPort}`));

function genId() {
    const chars = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const length = 20;
    let id = "";
    for (let i = 0; i < length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        id += char;
    }
    if (connections.find(i => i.id === id)) return genId();
    return id;
}