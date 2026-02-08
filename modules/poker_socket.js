const Game = require('../classes/game.js');
const Player = require('../classes/player.js');

let rooms = [];

function initializePoker(io) {
    const pokerNamespace = io.of('/poker_socket');

    pokerNamespace.on('connection', (socket) => {
        // Authenticate using res.locals.user if possible, 
        // but Socket.io in SYZOJ might need the session from the handshake.
        // For now, we'll assume the client sends the username from res.locals.user.
        
        socket.on('host', (data) => {
            if (!data.username || data.username.length > 12) {
                socket.emit('hostRoom', undefined);
            } else {
                let code;
                do {
                    code = Math.floor(1000 + Math.random() * 9000).toString();
                } while (rooms.some((r) => r.getCode() === code));
                
                const game = new Game(code, data.username);
                rooms.push(game);
                game.addPlayer(data.username, socket);
                game.emitPlayers('hostRoom', {
                    code: code,
                    players: game.getPlayersArray(),
                });
            }
        });

        socket.on('join', (data) => {
            const game = rooms.find((r) => r.getCode() === data.code);
            if (!game || game.getPlayersArray().includes(data.username) || !data.username || data.username.length > 12) {
                socket.emit('joinRoom', undefined);
            } else {
                game.addPlayer(data.username, socket);
                game.emitPlayers('joinRoom', {
                    host: game.getHostName(),
                    players: game.getPlayersArray(),
                });
                game.emitPlayers('hostRoom', {
                    code: data.code,
                    players: game.getPlayersArray(),
                });
            }
        });

        socket.on('startGame', (data) => {
            const game = rooms.find((r) => r.getCode() == data.code);
            if (game) {
                game.emitPlayers('gameBegin', { code: data.code });
                game.startGame();
            } else {
                socket.emit('gameBegin', undefined);
            }
        });

        socket.on('evaluatePossibleMoves', () => {
            const game = rooms.find(r => r.findPlayer(socket.id).socket.id === socket.id);
            if (game && game.roundInProgress) {
                const possibleMoves = game.getPossibleMoves(socket);
                socket.emit('displayPossibleMoves', possibleMoves);
            }
        });

        socket.on('raiseModalData', () => {
            const game = rooms.find(r => r.findPlayer(socket.id).socket.id === socket.id);
            if (game) {
                socket.emit('updateRaiseModal', {
                    topBet: game.getCurrentTopBet(),
                    usernameMoney: game.getPlayerBetInStage(game.findPlayer(socket.id)) + game.findPlayer(socket.id).getMoney(),
                });
            }
        });

        socket.on('startNextRound', () => {
            const game = rooms.find(r => r.findPlayer(socket.id).socket.id === socket.id);
            if (game && !game.roundInProgress) {
                game.startNewRound();
            }
        });

        socket.on('moveMade', (data) => {
            const game = rooms.find(r => r.findPlayer(socket.id).socket.id === socket.id);
            if (game) {
                if (data.move == 'fold') game.fold(socket);
                else if (data.move == 'check') game.check(socket);
                else if (data.move == 'bet') game.bet(socket, data.bet);
                else if (data.move == 'call') game.call(socket);
                else if (data.move == 'raise') game.raise(socket, data.bet);
            }
        });

        socket.on('disconnect', () => {
            const game = rooms.find(r => r.findPlayer(socket.id).socket.id === socket.id);
            if (game) {
                const player = game.findPlayer(socket.id);
                game.disconnectPlayer(player);
                if (game.players.length == 0) {
                    rooms = rooms.filter((r) => r !== game);
                }
            }
        });
    });
}

module.exports = { initializePoker };
