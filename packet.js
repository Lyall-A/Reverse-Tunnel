function createHeaders(headers) {
    // if (!headers.version || !headers.address || !headers.action) return null;
    if (!headers.version || !headers.action) return null;
    // return `${headers.version}\r\n${headers.address}\r\n${headers.action}\r\n${headers.dataLength ?? 0}${headers.additional ? `\r\n${Object.entries(headers.additional).map(([key, value]) => `${key}: ${value}`).join("\r\n")}` : ""}`;
    return `${headers.version}\r\n${headers.action}\r\n${headers.dataLength ?? 0}${headers.additional ? `\r\n${Object.entries(headers.additional).map(([key, value]) => `${key}: ${value}`).join("\r\n")}` : ""}`;
}

function parseHeaders(rawHeaders) {
    const lines = rawHeaders.split("\r\n");

    const version = parseFloat(lines[0]?.match(/^\d+(?:.\d+)?$/)?.[0]) || null;
    // const address = lines[1]?.match(/^(?:\d{1,3}\.){3}\d{1,3}$/)?.[0] || null;
    const action = lines[1]?.match(/^[A-Z_]+$/)?.[0] || null;
    const dataLength = parseInt(lines[2]?.match(/^\d+$/)?.[0]) ?? null;
    const additional = Object.fromEntries(lines.slice(3).map(i => {
        const match = i.match(/^(.+)\s*:\s*(.+)$/);
        const key = match?.[1];
        const value = match?.[2];
        return (key && value) ? [key, value] : null
    }).filter(i => i));

    // if (version === null || address === null || action === null || dataLength === null) return null;
    if (version === null || action === null || dataLength === null) return null;

    return {
        version,
        // address,
        action,
        dataLength,
        additional
    };
}

function createPacket(headers, data) {
    const headersString = createHeaders(headers);

    if (!headersString) return null;

    return Buffer.concat([
        Buffer.from(headersString),
        Buffer.from("\r\n\r\n"),
        data || Buffer.alloc(0)
    ]);
}

function parsePackets(buffer) {
    const packets = [];

    const [rawHeaders] = buffer.toString().split("\r\n\r\n");

    const headers = parseHeaders(rawHeaders);
    if (!headers) return packets;

    const headerLength = Buffer.byteLength(rawHeaders);
    const seperatorLength = 4;
    const dataLength = headers.dataLength;
    const length = headerLength + seperatorLength + dataLength;

    const packet = buffer.subarray(0, length);
    const data = packet.subarray(headerLength + seperatorLength);

    packets.push({
        packet,
        rawHeaders,
        headers,
        data
    });
    
    if (buffer.byteLength > packet.byteLength) packets.push(...parsePackets(buffer.subarray(length)));

    return packets;
}

function sendPackets(socket, packets) {
    for (const packet of packets) {
        const { headers, data } = packet;
        const packetBuffer = createPacket(headers, data);
    
        if (!packetBuffer) return false;
    
        socket.write(packetBuffer);
    }
}

module.exports = {
    createHeaders,
    parseHeaders,
    createPacket,
    parsePackets,
    sendPackets
}