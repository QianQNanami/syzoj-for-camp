const { GuandanGame, getReplay } = require('../classes/guandan_game');

let rooms = [];

function makeRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.some((room) => room.getCode() === code));
  return code;
}

function findRoomBySocket(socketId) {
  return rooms.find((room) => room.findPlayerBySocket(socketId));
}

function emitRoomLists(game) {
  const payload = {
    code: game.getCode(),
    host: game.getHostName(),
    players: game.getPlayersArray(),
  };
  game.emitPlayers('hostRoom', payload);
  game.emitPlayers('joinRoomUpdate', payload);
  game.rerender();
}

function emitActionResult(socket, result) {
  if (!result || result.ok) return;
  if (result.needsChoice) {
    socket.emit('playChoiceNeeded', { options: result.options });
    return;
  }
  socket.emit('actionError', { message: result.message || 'Invalid action.' });
}

function initializeGuandan(io) {
  const guandanNamespace = io.of('/guandan_socket');

  guandanNamespace.on('connection', (socket) => {
    socket.on('host', (data) => {
      if (!data || !data.username || data.username.length > 12) {
        socket.emit('hostRoom', undefined);
        return;
      }

      const code = makeRoomCode();
      const game = new GuandanGame(code, data.username);
      rooms.push(game);
      game.addPlayer(data.username, socket, data.userId);
      socket.emit('hostRoom', {
        code,
        host: game.getHostName(),
        players: game.getPlayersArray(),
      });
      game.rerender();
    });

    socket.on('join', (data) => {
      const game = data && rooms.find((room) => room.getCode() === data.code);
      if (!game || !data.username || data.username.length > 12) {
        socket.emit('joinRoom', undefined);
        return;
      }

      const existingPlayer = game.players.find((player) => player.username === data.username);
      if (existingPlayer) {
        if (existingPlayer.away) {
          game.reconnectPlayer(data.username, socket);
          socket.emit('gameBegin', { code: game.getCode() });
          socket.emit('joinRoom', {
            code: game.getCode(),
            host: game.getHostName(),
            players: game.getPlayersArray(),
          });
          return;
        }
        socket.emit('joinRoom', undefined);
        return;
      }

      const player = game.addPlayer(data.username, socket, data.userId);
      if (!player) {
        socket.emit('joinRoom', undefined);
        return;
      }

      socket.emit('joinRoom', {
        code: game.getCode(),
        host: game.getHostName(),
        players: game.getPlayersArray(),
      });
      emitRoomLists(game);
    });

    socket.on('startGame', (data) => {
      const game = data && rooms.find((room) => room.getCode() === data.code);
      if (!game || game.getHostName() !== data.username || !game.startGame()) {
        socket.emit('gameBegin', undefined);
      }
    });

    socket.on('playCards', (data) => {
      const game = findRoomBySocket(socket.id);
      if (!game) return;
      emitActionResult(socket, game.playCards(socket.id, data && data.cardIds, data && data.choice));
    });

    socket.on('pass', () => {
      const game = findRoomBySocket(socket.id);
      if (!game) return;
      emitActionResult(socket, game.pass(socket.id));
    });

    socket.on('selectTribute', (data) => {
      const game = findRoomBySocket(socket.id);
      if (!game) return;
      emitActionResult(socket, game.selectTribute(socket.id, data && data.cardId));
    });

    socket.on('selectReturn', (data) => {
      const game = findRoomBySocket(socket.id);
      if (!game) return;
      emitActionResult(socket, game.selectReturn(socket.id, data && data.cardId));
    });

    socket.on('startNextHand', () => {
      const game = findRoomBySocket(socket.id);
      if (!game) return;
      emitActionResult(socket, game.confirmNextHand(socket.id));
    });

    socket.on('playerExit', () => {
      const game = findRoomBySocket(socket.id);
      if (!game) return;
      game.removePlayer(socket.id);
      if (game.players.length === 0) rooms = rooms.filter((room) => room !== game);
    });

    socket.on('spectate', (data) => {
      const game = data && rooms.find((room) => room.getCode() === data.code);
      if (!game || !data.username || data.username.length > 12) {
        socket.emit('spectateJoin', undefined);
        return;
      }

      game.addSpectator(data.username, socket);
      socket.emit('spectateJoin', {
        code: game.getCode(),
        host: game.getHostName(),
      });
      socket.emit('spectateState', game.stateForSpectator());
    });

    socket.on('spectatorExit', () => {
      for (const room of rooms) room.removeSpectatorBySocket(socket.id);
    });

    socket.on('requestReplay', (data) => {
      const replay = data && getReplay(data.replayId);
      socket.emit('replayData', replay || undefined);
    });

    socket.on('disconnect', () => {
      for (const room of rooms) room.removeSpectatorBySocket(socket.id);

      const game = findRoomBySocket(socket.id);
      if (!game) return;
      const player = game.findPlayerBySocket(socket.id);
      if (game.phase === 'lobby') {
        game.removePlayer(socket.id);
        if (game.players.length === 0) rooms = rooms.filter((room) => room !== game);
        else emitRoomLists(game);
      } else {
        game.disconnectPlayer(player);
      }
    });
  });
}

module.exports = { initializeGuandan };
