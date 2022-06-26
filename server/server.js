const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const ROOM_PREFIX = "room-";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('./static'));
app.get('*', (req, res) => res.sendFile(__dirname + '/static/index.html'));

const games = new Map();
const newGame = (oldGame = null) => {
  // note: to avoid confusion, all indices are SEAT numbers, player A or B. Not X/O.
  const g = {
    players: [null, null], // ids of players
    closeTimeout: null, // setTimeout id for closing room
    ...oldGame,
    pub: { // public info
      names: [null, null], // names of the players
      scores: [0, 0], // scores of players
      watchers: 0, // number of people watching
      msgs: [], // array of [+new Date(), "message"]
      ...oldGame?.pub,
      board: [[' ', ' ', ' '], [' ', ' ', ' '], [' ', ' ', ' ']],
      xplayer: oldGame?.pub?.xplayer ? 1-oldGame.pub.xplayer :
                Math.floor(Math.random()*2), // which player is X (goes first)
      turn: null, // which player is currently up to play
      end: null, // which player has won, or 2 if tie, null if not ended
    },
    goals: Array(2).fill(0).map(() => Math.floor(Math.random()*3)) // which player they want to win
  };
  // initially, x always goes first
  g.pub.turn = g.pub.xplayer;
  return g;
};

// returns null, 0, 1, 2 for X, O, draw
const checkEnd = board => {
  let end = null;
  const f = ([a, b, c]) => {
    if (a === ' ' || a !== b || a !== c) return;
    if (a === 'X') end = 0;
    else end = 1;
  };
  const arr = [0, 1, 2];
  for (const i of arr) f(board[i]);
  for (const j of arr) f(arr.map(i => board[i][j]));
  f(arr.map(d => board[d][d]));
  f(arr.map(d => board[d][2-d]));
  if (end === null && !board.flat().includes(' ')) return 2;
  return end;
};

io.of("/").adapter.on("create-room", room => {
  if (!room.startsWith(ROOM_PREFIX)) return;

  // if room exists, reset closing, otherwise, new room
  if (games.has(room)) {
    clearTimeout(games.get(room).closeTimeout);
    emitPubMsg(room, "Room deletion cancelled");
    return;
  }

  games.set(room, newGame());
  emitPubMsg(room, "Room " + room.substr(ROOM_PREFIX.length) + " created");
});

io.of("/").adapter.on("delete-room", room => {
  if (!room.startsWith(ROOM_PREFIX)) return;
  games.get(room).closeTimeout = setTimeout(() => games.delete(room), 60*60*1000);
  emitPubMsg(room, "Room is empty :( and will be deleted in 1 hour");
});

const emitPub = room => {
  io.to(room).emit("pub", games.get(room).pub);
};

const emitMe = (socket, room, id) => {
  /*
  me = {
    goal: 0=X / 1=O / 2=draw (note, xor who you are before drawing)
    idx: -1 / 0 / 1
  }
  */
  const {players, goals} = games.get(room);
  const idx = players.findIndex(x => x === id);
  socket.emit("me", {goal: idx === -1 ? null : goals[idx], idx});
};

const addMsg = (room, m) => {
  games.get(room).pub.msgs.push([+new Date(), m]);
};

// since emit + publish happens so often
const emitPubMsg = (room, m) => {
  addMsg(room, m);
  emitPub(room);
};

io.of("/").adapter.on("join-room", (room, id) => {
  if (!room.startsWith(ROOM_PREFIX)) return;
  games.get(room).pub.watchers++;
  emitPubMsg(room, "- " + games.get(room).pub.watchers + " in room");
});
io.of("/").adapter.on("leave-room", (room, id) => {
  if (!room.startsWith(ROOM_PREFIX)) return;
  games.get(room).pub.watchers--;
  emitPubMsg(room, "- " + games.get(room).pub.watchers + " in room");
});

io.on('connection', socket => {
  const {id} = socket;
  let room = null;

  socket.on('join', _room => {
    if (!_room.match(/^[0-9a-f]{8}$/)) return;
    room = ROOM_PREFIX + _room;

    // join emits state already through emitPubMsg, either room create or room join
    socket.join(room);
    emitMe(socket, room, id);
  });

  socket.on('seat', name => {
    const game = games.get(room);
    if (!game || !name) return;
    if (game.players.includes(id)) return;

    name = name.replace(/[^\x20-\x7e]+/g, '');
    if (game.players[0] === null) {
      game.players[0] = id;
      game.pub.names[0] = name;
      emitPubMsg(room, name + " sat down as Player A");
    } else if (game.players[1] === null) {
      game.players[1] = id;
      game.pub.names[1] = name;
      emitPubMsg(room, name + " sat down as Player B");
    } else return;
    emitMe(socket, room, id);
  });

  socket.on('play', ({i, j}) => {
    const game = games.get(room);
    if (!game) return;
    if (game.players.includes(null)) return;

    const idx = game.players.findIndex(x => x === id);
    if (idx !== game.pub.turn) return;
    if (game.pub.board[i][j] !== ' ') return;
    if (game.pub.end !== null) return;

    game.pub.turn = 1-game.pub.turn;
    game.pub.board[i][j] = game.pub.xplayer === idx ? 'X' : 'O';
    addMsg(room, game.pub.names[idx] + " made a move as " + game.pub.board[i][j] + ": (" + i + ", " + j + ")");

    // check if the game ends, and make it into the seat number rather than X/O
    let end = checkEnd(game.pub.board);
    if ((end === 0 || end === 1) && game.pub.xplayer === 1) end = 1-end;
    game.pub.end = end;

    if (game.pub.end !== null) {
      // game just ended
      addMsg(room, "Round ended as a " + (game.pub.end === 2 ? "draw" : "win for " + game.pub.names[game.pub.end]));
      for (const x of [0, 1])
        addMsg(room, game.pub.names[x] + " was playing to " + (game.goals[x] === 2 ? "draw" : (game.goals[x] === x ? "win" : "lose")));
      for (const x of [0, 1]) {
        if (game.pub.end === game.goals[x]) {
          game.pub.scores[x]++;
          addMsg(room, game.pub.names[x] + " got a point");
        }
      }
    }
    emitPub(room);
  });

  socket.on('next', () => {
    let game = games.get(room);
    if (!game) return;
    if (game.players.includes(null)) return;
    if (game.pub.end === -1) return;

    game = newGame(game);
    games.set(room, game);
    // emitMe for both sides
    for (const id of game.players)
      emitMe(io.sockets.sockets.get(id), room, id);

    emitPubMsg(room, "=== New round set up");
  });

  socket.on("disconnecting", (reason) => {
    let game = games.get(room);
    if (!game) return;
    const idx = game.players.findIndex(x => x === id);
    if (idx !== -1) {
      game.players[idx] = null;
      const name = game.pub.names[idx];
      game.pub.names[idx] = null;
      emitPubMsg(room, name + " disconnected, leaving a player slot open");
    }
  });
});

process.on('SIGTERM', () => process.exit(0));
server.listen(3000);
