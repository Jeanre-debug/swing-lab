"use strict";

const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8787;
const wss = new WebSocketServer({ port: PORT });

// Phase 1 has exactly one possible laptop, so there's nothing to route between rooms —
// any message from a phone client just broadcasts to every other connected client.
wss.on("connection", function (ws) {
  console.log("client connected, total:", wss.clients.size);

  ws.on("message", function (data) {
    wss.clients.forEach(function (client) {
      if (client !== ws && client.readyState === client.OPEN) {
        client.send(data.toString());
      }
    });
  });

  ws.on("close", function () {
    console.log("client disconnected, total:", wss.clients.size);
  });
});

console.log("Swing Lab relay listening on ws://localhost:" + PORT);
