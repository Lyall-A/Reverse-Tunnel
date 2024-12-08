const net = require("net");
const tls = require("tls");

const { parsePackets, sendPackets } = require("./packet");

const { relayHost, relayPort, authorization, serverHost, serverPort, reconnectTimeout } = require("./server.config.json");

const connections = [];

(function connectRelay() {
    let handshaked = false;
    let heartbeatInterval;
    let heartbeatTimeout;
    let pingDate = null;

    console.log(`Connecting to relay at ${relayHost}:${relayPort}`);

    const relayConnection = net.createConnection({
        host: relayHost,
        port: relayPort
    }, () => {
        console.log(`Connected to relay at ${relayHost}:${relayPort}`);
        sendHandshake();

        // setInterval(() => {
        //     pingDate = Date.now();
        //     sendPing();
        // }, 1000);
    });

    relayConnection.on("data", i => {
        const packets = parsePackets(i);

        for (const packet of packets) {
            const { headers, data } = packet;

            // console.log(`Received ${headers.action}`);

            // HELLO
            if (headers.action === "HELLO") {
                if (handshaked) return;
                if (!headers.additional.heartbeat_interval) return destroy("Received HELLO with no heartbeat interval");
                heartbeatInterval = headers.additional.heartbeat_interval;
                handshaked = true;
                heartbeatTimeout = setTimeout(sendHeartbeat, heartbeatInterval);
            }

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

            // HEARTBEAT_ACK
            if (headers.action === "HEARTBEAT_ACK") {
                heartbeatTimeout = setTimeout(sendHeartbeat, heartbeatInterval);
            }

            // NEW_CONNECTION
            if (headers.action === "NEW_CONNECTION") {
                const id = headers.additional.id;
                if (!id) return destroy("Received NEW_CONNECTION with no ID");

                const queue = [];
                console.log(`Creating new connection for ${id}`);

                const serverConnection = net.createConnection({
                    host: serverHost,
                    port: serverPort
                }, () => {
                    sendConnectionCreated(id);
                });

                const connection = {
                    serverConnection,
                    id,
                    created: false,
                    queue,
                    sendQueue,
                    send,
                    close
                };

                connections.push(connection);

                serverConnection.on("data", data => {
                    if (connection.created) {
                        sendData(id, data);
                    } else {
                        queue.push(data);
                    }
                });
                serverConnection.on("close", close);
                serverConnection.on("end", close);
                serverConnection.on("error", close);

                function close() {
                    const foundConnection = connections.findIndex(i => i.id === id);
                    if (foundConnection < 0) return;
                    connections.splice(foundConnection, 1);
                    sendClose(id);
                }

                function send(data) {
                    // TODO: handle large data correctly
                    serverConnection.write(data);
                }

                function sendQueue() {
                    while (queue[0]) {
                        sendData(id, queue[0]);
                        queue.shift();
                    }
                }
            }

            // CONNECTION_CREATED_ACK
            if (headers.action === "CONNECTION_CREATED_ACK") {
                const id = headers.additional.id;
                if (!id) return destroy("Received CONNECTION_CREATED_ACK with no ID");

                const connection = connections.find(i => i.id === id);
                if (!connection) return;

                connection.created = true;
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

                connection.serverConnection.end();
            }
        }
    })

    relayConnection.on("close", () => {
        clearTimeout(heartbeatTimeout);
        console.log("Relay closed");
        if (reconnectTimeout) {
            console.log(`Reconnecting in ${reconnectTimeout}ms`);
            setTimeout(connectRelay, reconnectTimeout);
        }
    });
    relayConnection.on("error", err => {
        console.log("Relay error:", err);
    });

    function destroy(message) {
        if (message) console.log(message);
        relayConnection.destroy();
    }

    function sendHandshake() {
        console.log("Sending HANDSHAKE");
        return sendPackets(relayConnection, [{
            headers: {
                version: 1,
                action: "HANDSHAKE",
                additional: {
                    authorization
                }
            }
        }]);
    }

    function sendPing() {
        // console.log("Sending PING");
        return sendPackets(relayConnection, [{
            headers: {
                version: 1,
                action: "PING"
            }
        }]);
    }

    function sendPong() {
        // console.log("Sending PONG");
        return sendPackets(relayConnection, [{
            headers: {
                version: 1,
                action: "PONG"
            }
        }]);
    }

    function sendHeartbeat() {
        // console.log("Sending HEARTBEAT");
        return sendPackets(relayConnection, [{
            headers: {
                version: 1,
                action: "HEARTBEAT"
            }
        }]);
    }

    function sendConnectionCreated(id) {
        // console.log("Sending CONNECTION_CREATED");
        return sendPackets(relayConnection, [{
            headers: {
                version: 1,
                action: "CONNECTION_CREATED",
                additional: { id }
            }
        }]);
    }

    function sendData(id, data) {
        // console.log("Sending DATA");
        return sendPackets(relayConnection, [{
            headers: {
                version: 1,
                action: "DATA",
                dataLength: data.byteLength,
                additional: { id }
            },
            data
        }]);
    }

    function sendClose(id) {
        // console.log("Sending CLOSE");
        return sendPackets(relayConnection, [{
            headers: {
                version: 1,
                action: "CLOSE",
                additional: { id }
            }
        }]);
    }
})();