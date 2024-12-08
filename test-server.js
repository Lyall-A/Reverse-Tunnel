const net = require("net");

const server = net.createServer();

server.on("connection", socket => {
    console.log(`Connection from ${socket.remoteAddress}`);

    socket.once("data", i => {
        socket.end("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nHIIIII");
    });
});

server.listen(8080);