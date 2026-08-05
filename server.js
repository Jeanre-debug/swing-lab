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
// code -> { host, players: Map(playerId -> {ws, name, connected}), nextPlayerId, lastRoundStarted, lastTurnPlayerId }
const rooms = new Map();

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
  return Array.from(room.players.entries()).map(function ([id, p]) {
    return { id: id, name: p.name, connected: p.connected };
  });
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
      rooms.set(code, { host: ws, players: new Map(), nextPlayerId: 1, lastRoundStarted: false, lastTurnPlayerId: null });
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
      var name = String(msg.name || "Player").slice(0, 20);

      // Rejoin: someone reconnecting (screen lock, dropped wifi, phone put away) under the
      // same name reuses their existing player id rather than getting a fresh one — the
      // laptop's already-in-progress state for that player (score, ball position, whose turn
      // it is) is keyed off this id, so a new one would orphan all of it.
      var nameKey = name.trim().toLowerCase();
      var playerId = null;
      room.players.forEach(function (p, id) {
        if (!playerId && p.name.trim().toLowerCase() === nameKey) playerId = id;
      });

      if (playerId) {
        var existing = room.players.get(playerId);
        existing.ws = ws;
        existing.connected = true;
      } else {
        playerId = "p" + room.nextPlayerId++;
        room.players.set(playerId, { ws: ws, name: name, connected: true });
      }
      ws.role = "player";
      ws.roomCode = roomCode;
      ws.playerId = playerId;
      send(ws, { type: "joined", code: roomCode, playerId: playerId, name: name });
      // A (re)joining player has no way to otherwise learn a round is already under way, or
      // whose turn it currently is — without this a reconnecting player could sit on the
      // waiting screen indefinitely even if the rotation's already come back around to them.
      if (room.lastRoundStarted) send(ws, { type: "start_round" });
      if (room.lastTurnPlayerId) send(ws, { type: "turn", playerId: room.lastTurnPlayerId });
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
      // own state, it doesn't need these echoed back. Also remembered per-room so a player who
      // (re)joins mid-round can be caught up immediately above, instead of only finding out
      // next time the turn naturally changes.
      if (msg.type === "start_round") {
        myRoom.lastRoundStarted = true;
        broadcastToPlayers(myRoom, msg);
      } else if (msg.type === "turn") {
        myRoom.lastTurnPlayerId = msg.playerId;
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
      var entry = joinedRoom ? joinedRoom.players.get(ws.playerId) : null;
      // Marked disconnected rather than removed, so the rest of the round can keep going
      // without this player while leaving the door open for them to rejoin later and pick up
      // right where they left off. Only if this socket is still the one on record for them —
      // a rejoin may have already replaced it with a new connection, and that new connection's
      // own close handler (whenever it eventually fires) shouldn't get to undo the rejoin.
      if (entry && entry.ws === ws) {
        entry.connected = false;
        broadcastRoster(joinedRoom);
      }
    }
  });
});

console.log("Swing Lab relay listening on ws://localhost:" + PORT);
