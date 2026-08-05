"use strict";

const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8787;
const wss = new WebSocketServer({ port: PORT });

// Room-aware relay: one laptop hosts a room (gets a short join code), any number of phones
// join that room as players. Player-originated messages (swing/practice/power/club) only ever
// go to that room's host — phones never need to hear each other directly. Host-originated
// messages that matter to players (turn order, round start, room closing) broadcast to every
// player in the room instead.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — easy to misread out loud
const rooms = new Map(); // code -> { host: ws|null, players: Map(playerId -> {ws, name}), nextPlayerId }

function makeRoomCode() {
  var code;
  do {
    code = "";
    for (var i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function roster(room) {
  return Array.from(room.players.entries()).map(function ([id, p]) { return { id: id, name: p.name }; });
}

function broadcastRoster(room) {
  var msg = { type: "roster", players: roster(room) };
  send(room.host, msg);
  room.players.forEach(function (p) { send(p.ws, msg); });
}

function broadcastToPlayers(room, msg) {
  room.players.forEach(function (p) { send(p.ws, msg); });
}

wss.on("connection", function (ws) {
  // Filled in once this connection identifies itself as a host or a player, so close/cleanup
  // knows what to tear down without having to search every room.
  ws.role = null; // "host" | "player"
  ws.roomCode = null;
  ws.playerId = null;

  ws.on("message", function (data) {
    var msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return; // ignore malformed frames
    }

    if (msg.type === "host_create") {
      var code = makeRoomCode();
      rooms.set(code, { host: ws, players: new Map(), nextPlayerId: 1 });
      ws.role = "host";
      ws.roomCode = code;
      send(ws, { type: "room_created", code: code });
      return;
    }

    if (msg.type === "player_join") {
      var roomCode = String(msg.code || "").toUpperCase();
      var room = rooms.get(roomCode);
      if (!room) {
        send(ws, { type: "join_error", reason: "Room not found" });
        return;
      }
      var playerId = "p" + room.nextPlayerId++;
      var name = String(msg.name || "Player").slice(0, 20);
      room.players.set(playerId, { ws: ws, name: name });
      ws.role = "player";
      ws.roomCode = roomCode;
      ws.playerId = playerId;
      send(ws, { type: "joined", code: roomCode, playerId: playerId, name: name });
      broadcastRoster(room);
      return;
    }

    // Everything past this point requires the sender to already be registered in a room.
    var myRoom = ws.roomCode ? rooms.get(ws.roomCode) : null;
    if (!myRoom) return;

    if (ws.role === "player") {
      // swing / practice / power / club — always routed to the host only, and tagged with the
      // server's own record of who sent it rather than trusting anything the client claims, so
      // one phone can't pretend to be another.
      msg.playerId = ws.playerId;
      var senderInfo = myRoom.players.get(ws.playerId);
      msg.playerName = senderInfo ? senderInfo.name : null;
      send(myRoom.host, msg);
    } else if (ws.role === "host") {
      // start_round / turn — broadcast to every player in the room; the host already knows its
      // own state, it doesn't need these echoed back.
      if (msg.type === "start_round" || msg.type === "turn") {
        broadcastToPlayers(myRoom, msg);
      }
    }
  });

  ws.on("close", function () {
    if (ws.role === "host" && ws.roomCode) {
      var hostedRoom = rooms.get(ws.roomCode);
      if (hostedRoom) {
        broadcastToPlayers(hostedRoom, { type: "room_closed" });
        rooms.delete(ws.roomCode);
      }
    } else if (ws.role === "player" && ws.roomCode) {
      var joinedRoom = rooms.get(ws.roomCode);
      if (joinedRoom && joinedRoom.players.delete(ws.playerId)) {
        broadcastRoster(joinedRoom);
      }
    }
  });
});

console.log("Swing Lab relay listening on ws://localhost:" + PORT);
